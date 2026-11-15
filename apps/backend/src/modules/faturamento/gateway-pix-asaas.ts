import { Injectable, Logger } from '@nestjs/common';
import { cobrancaAsaasPaga, inicioDiaUTC } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { AsaasLeituraService } from '../asaas/asaas-leitura.service';
import { payloadPixSimulado } from '../asaas/pix';
import { webhookAsaasSchema } from '../cobranca/dto/webhook-asaas.dto';
import { intencaoDaReferencia, type EventoPix, type GatewayPix, type PixConsultado, type PixCriado } from './gateway-pix';

// Adaptador ASAAS do GatewayPix (doc 02 §32.4-A). O Pix da intenção é uma
// cobrança AVULSA do tipo PIX, com vencimento no dia e SEM `fine`/`interest`:
// o encargo é calculado pela Azit e já vem dentro do valor.
//
// LIMITAÇÃO conhecida (conferida na documentação do Asaas em 15/11/2026): a
// API de cobrança não tem campo para desligar as notificações POR COBRANÇA —
// só `notificationDisabled` no cadastro do cliente. Este adaptador NÃO mexe no
// cadastro de clientes existentes; logo, o Asaas avisa o cliente destas
// cobranças conforme o cadastro dele (doc 02 §32.10, pendência 8).
//
// Pix vencido no Asaas continua pagável: a validade "até 23h59" é garantida
// pelo job de virada do dia, que cancela a cobrança (DELETE). Se o cliente
// pagar na corrida, o dinheiro é aceito (§32.4-A: "o dinheiro manda").
@Injectable()
export class GatewayPixAsaas implements GatewayPix {
  readonly nome = 'asaas';
  private readonly logger = new Logger(GatewayPixAsaas.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly leitura: AsaasLeituraService,
  ) {}

  get simulado(): boolean {
    return this.asaas.simulado;
  }

  async criarPix(pedido: { referencia: string; valor: number; dia: string; descricao: string; titularId: string }): Promise<PixCriado> {
    // MEDIÇÃO (15/11): quanto demora cada chamada ao gateway — é o que o cliente
    // espera pelo código. O log sai no sucesso e na falha.
    const t0 = Date.now();
    const ms = { cliente: 0, cobranca: 0, qr: 0 };
    const medir = (resultado: string) =>
      this.logger.log(
        `criarPix ${pedido.referencia} (${pedido.valor}c): ${resultado} em ${Date.now() - t0} ms · cliente ${ms.cliente} ms · POST /payments ${ms.cobranca} ms · GET pixQrCode ${ms.qr} ms`,
      );
    let cobrancaId: string | null = null;
    try {
      const customerId = await this.clienteDoTitular(pedido.titularId);
      ms.cliente = Date.now() - t0;
      // Sem multaPct/jurosPct: `criarCobranca` só envia fine/interest quando recebem valor.
      const t1 = Date.now();
      const cobranca = await this.asaas.criarCobranca({
        externalReference: pedido.referencia,
        valor: pedido.valor,
        vencimento: inicioDiaUTC(pedido.dia),
        descricao: pedido.descricao,
        customerId,
      });
      ms.cobranca = Date.now() - t1;
      if (cobranca.simulada) {
        medir('simulado');
        return { gatewayId: cobranca.id, copiaECola: payloadPixSimulado(pedido.referencia, pedido.valor), qrCodeImagem: null, simulado: true };
      }
      cobrancaId = cobranca.id;
      const t2 = Date.now();
      const qr = await this.leitura.pixQrCode(cobranca.id).finally(() => {
        ms.qr = Date.now() - t2;
      });
      if (!qr?.payload) throw new Error('o gateway não devolveu o código Pix');
      medir('ok');
      return { gatewayId: cobranca.id, copiaECola: qr.payload, qrCodeImagem: qr.encodedImage ?? null, simulado: false };
    } catch (e) {
      medir(`FALHOU (${(e as Error).message})`);
      // Cobrança criada mas sem código: não deixa cobrança órfã pagável por aí.
      if (cobrancaId) await this.asaas.removerCobranca(cobrancaId);
      throw e;
    }
  }

  async cancelarPix(gatewayId: string): Promise<{ cancelado: boolean; pago: boolean }> {
    if (this.simulado || gatewayId.startsWith('pay_sim_')) return { cancelado: true, pago: false };
    // Olha ANTES de apagar: cobrança paga nunca é removida (regra de 21/10).
    const atual = await this.consultarPix(gatewayId);
    if (!atual.existe) return { cancelado: true, pago: false };
    if (atual.pago) return { cancelado: false, pago: true };
    return { cancelado: await this.asaas.removerCobranca(gatewayId), pago: false };
  }

  async consultarPix(gatewayId: string): Promise<PixConsultado> {
    const nada: PixConsultado = { existe: false, pago: false, valor: 0, dataPagamento: null, pagamentoId: null };
    if (this.simulado || gatewayId.startsWith('pay_sim_')) return nada;
    const c = await this.leitura.lerCobranca(gatewayId);
    if (!c || c.deleted) return nada;
    const pago = cobrancaAsaasPaga(c.status);
    return {
      existe: true,
      pago,
      valor: pago ? Math.round(c.value * 100) : 0,
      dataPagamento: pago ? (c.clientPaymentDate ?? c.paymentDate ?? c.confirmedDate ?? null) : null,
      pagamentoId: c.id,
    };
  }

  interpretarWebhook(corpo: unknown): EventoPix | null {
    const lido = webhookAsaasSchema.safeParse(corpo);
    if (!lido.success) return null;
    const pg = lido.data.payment;
    if (!pg?.id || !intencaoDaReferencia(pg.externalReference)) return null;
    return {
      referencia: pg.externalReference!,
      pago: lido.data.event === 'PAYMENT_RECEIVED' || lido.data.event === 'PAYMENT_CONFIRMED',
      pagamentoId: pg.id,
      valor: Math.round((pg.value ?? 0) * 100),
      dataPagamento: pg.clientPaymentDate ?? pg.paymentDate ?? pg.confirmedDate ?? null,
      identificadorPix: typeof pg.pixTransaction === 'string' ? pg.pixTransaction : null,
    };
  }

  // Cliente do titular no Asaas (idempotente) — mesma regra da cobrança de
  // fatura: id simulado não vale em modo real; cadastro existente é reusado
  // como está (não se altera notificação nem dado nenhum).
  private async clienteDoTitular(titularId: string): Promise<string> {
    const titular = await this.prisma.db.titular.findFirst({
      where: { id: titularId },
      select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true },
    });
    if (!titular) throw new Error(`Titular ${titularId} não encontrado para gerar o Pix`);
    const reutilizavel = this.asaas.clienteReutilizavel(titular.asaasCustomerId);
    if (reutilizavel) return reutilizavel;
    const customerId = await this.asaas.criarCliente({ titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp });
    await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    this.logger.log(`Cliente do titular ${titular.id} criado no gateway para Pix sob demanda`);
    return customerId;
  }
}
