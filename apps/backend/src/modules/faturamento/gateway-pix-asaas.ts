import { Injectable, Logger } from '@nestjs/common';
import { cobrancaAsaasPaga, inicioDiaUTC } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { limiteQrPixMs } from '../asaas/asaas-http';
import { AsaasHttpError, AsaasLeituraService, type CobrancaAsaasLida } from '../asaas/asaas-leitura.service';
import { payloadPixSimulado } from '../asaas/pix';
import { webhookAsaasSchema } from '../cobranca/dto/webhook-asaas.dto';
import {
  intencaoDaReferencia,
  type ChaveRecebimentoPix,
  type EventoPix,
  type GatewayPix,
  type PedidoPix,
  type PixConsultado,
  type PixCriado,
} from './gateway-pix';
import { parametrosFaturamentoVigentes } from './parametros-faturamento.service';

// Adaptador ASAAS do GatewayPix (doc 02 §32.4-A). Dois modos, escolhidos pelo
// parâmetro versionado `modoPix` (Configurações › Faturamento):
//
// · ESTATICO (padrão, decisão Luís 15/11): QR Code ESTÁTICO com valor, pagamento
//   único, validade até 23h59 do dia. UMA chamada (`POST /pix/qrCodes/static`),
//   que já devolve o copia-e-cola e a imagem; não cria cobrança nem cliente.
//   Ao receber, o Asaas cria sozinho uma cobrança já recebida com `pixQrCodeId`
//   = id do QR — é por ele que o pagamento volta para a intenção. Sem cobrança
//   em nome do cliente, o Asaas não avisa o cliente de nada.
//   Por quê: no sandbox (homolog 15/11) a cobrança nascia em ~0,7 s, mas o
//   `GET /payments/{id}/pixQrCode` não respondia nem em 30 s.
//
// · COBRANCA (o modo anterior, opção de volta): cobrança AVULSA do tipo PIX, com
//   vencimento no dia e SEM `fine`/`interest`, seguida da consulta do código.
//   Aqui o Asaas avisa o cliente conforme o cadastro dele (não há campo para
//   desligar notificação por cobrança) e a validade "até 23h59" é garantida
//   pelo job de virada do dia, que remove a cobrança.
//
// O id guardado na intenção (`gatewayId`) diz de que modo o Pix nasceu: id de
// cobrança do Asaas começa com `pay_`; o resto é QR estático. Assim cancelar e
// consultar seguem o modo em que cada Pix nasceu, mesmo depois de o parâmetro mudar.
//
// Nos dois modos, Pix pago na corrida do cancelamento é aceito (§32.4-A: "o
// dinheiro manda").

interface ChavePixAsaas {
  id: string;
  key: string;
  type?: string | null;
  status?: string | null;
}

interface QrEstaticoAsaas {
  id: string;
  payload: string;
  encodedImage?: string | null;
}

const PREFIXO_COBRANCA = 'pay_';
const PREFIXO_QR_SIMULADO = 'qr_sim_';
// Espaço do texto livre no QR estático com chave aleatória (36 caracteres): 37.
const LIMITE_DESCRICAO_QR = 37;

export const ehCobrancaAsaas = (gatewayId: string): boolean => gatewayId.startsWith(PREFIXO_COBRANCA);

// Texto do QR: só ASCII simples (o padrão do QR não garante acento) e curto.
export function descricaoParaQr(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,#/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITE_DESCRICAO_QR)
    .trim();
}

// A chave aparece na tela de Configurações só o bastante para ser reconhecida.
export function mascararChavePix(chave: string): string {
  const c = chave.trim();
  if (c.includes('@')) {
    const [usuario, dominio] = c.split('@');
    return `${usuario.slice(0, 2)}•••@${dominio}`;
  }
  return c.length <= 8 ? `${c.slice(0, 2)}•••` : `${c.slice(0, 4)}•••${c.slice(-4)}`;
}

@Injectable()
export class GatewayPixAsaas implements GatewayPix {
  readonly nome = 'asaas';
  private readonly logger = new Logger(GatewayPixAsaas.name);
  // Chave Pix ativa da conta (quem recebe o QR estático), guardada em memória.
  // É recarregada quando a criação do QR falha e a cada consulta da tela.
  private chaveEmMemoria: ChavePixAsaas | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly leitura: AsaasLeituraService,
  ) {}

  get simulado(): boolean {
    return this.asaas.simulado;
  }

  async criarPix(pedido: PedidoPix): Promise<PixCriado> {
    const { modoPix } = await parametrosFaturamentoVigentes(this.prisma.db);
    return modoPix === 'COBRANCA' ? this.criarPorCobranca(pedido) : this.criarQrEstatico(pedido);
  }

  // ---------------------------------------------------------------
  // Modo ESTATICO
  // ---------------------------------------------------------------
  private async criarQrEstatico(pedido: PedidoPix): Promise<PixCriado> {
    // MEDIÇÃO: quanto demora cada chamada ao gateway — é o que o cliente espera
    // pelo código. O log sai no sucesso e na falha.
    const t0 = Date.now();
    const ms = { chave: 0, qr: 0 };
    const medir = (resultado: string) =>
      this.logger.log(
        `criarPix ${pedido.referencia} (${pedido.valor}c) [QR estático]: ${resultado} em ${Date.now() - t0} ms · chave ${ms.chave} ms · POST /pix/qrCodes/static ${ms.qr} ms`,
      );
    if (this.simulado) {
      medir('simulado');
      return {
        gatewayId: `${PREFIXO_QR_SIMULADO}${pedido.referencia.replace(/[^A-Za-z0-9_-]/g, '_')}`,
        copiaECola: payloadPixSimulado(pedido.referencia, pedido.valor),
        qrCodeImagem: null,
        simulado: true,
      };
    }
    try {
      let chave = await this.chaveAtiva();
      ms.chave = Date.now() - t0;
      const t1 = Date.now();
      let qr: QrEstaticoAsaas;
      try {
        qr = await this.postQrEstatico(pedido, chave.key);
      } catch (e) {
        // A chave guardada pode ter sido trocada/removida no Asaas: recarrega e,
        // se for OUTRA, tenta uma vez com ela. Tempo esgotado não repete (o
        // cliente está esperando).
        if (!(e instanceof AsaasHttpError)) throw e;
        const anterior = chave.key;
        this.chaveEmMemoria = null;
        chave = await this.chaveAtiva();
        if (chave.key === anterior) throw e;
        this.logger.warn(`criarPix ${pedido.referencia}: a chave Pix mudou no Asaas — tentando de novo com a chave atual`);
        qr = await this.postQrEstatico(pedido, chave.key);
      } finally {
        ms.qr = Date.now() - t1;
      }
      if (!qr?.id || !qr.payload) throw new Error('o gateway não devolveu o código Pix');
      medir('ok');
      return { gatewayId: qr.id, copiaECola: qr.payload, qrCodeImagem: qr.encodedImage ?? null, simulado: false };
    } catch (e) {
      medir(`FALHOU (${(e as Error).message})`);
      throw e;
    }
  }

  private postQrEstatico(pedido: PedidoPix, addressKey: string): Promise<QrEstaticoAsaas> {
    return this.leitura.requisicao<QrEstaticoAsaas>(
      'POST',
      '/pix/qrCodes/static',
      {
        addressKey,
        value: pedido.valor / 100, // o Asaas recebe reais
        description: descricaoParaQr(pedido.descricaoCurta),
        format: 'ALL',
        allowsMultiplePayments: false,
        // Validade: 23h59 do dia DO BRASIL (o `dia` já vem do fuso do negócio).
        expirationDate: `${pedido.dia} 23:59:59`,
        externalReference: pedido.referencia,
      },
      // Há um cliente esperando o código: sem a espera longa do 429, e com o
      // limite próprio da geração do código (ASAAS_PIX_QR_TIMEOUT_MS).
      { semEspera: true, limiteMs: limiteQrPixMs() },
    );
  }

  // Primeira chave Pix ATIVA da conta. Sem chave: erro claro (quem pediu o Pix
  // recebe "Pix indisponível" e o motivo vai para o log e para a tela de Configurações).
  private async chaveAtiva(): Promise<ChavePixAsaas> {
    if (this.chaveEmMemoria) return this.chaveEmMemoria;
    const chave = await this.carregarChave();
    if (!chave) throw new Error('a conta no Asaas não tem chave Pix ativa — sem chave não há como gerar o QR');
    this.chaveEmMemoria = chave;
    return chave;
  }

  private async carregarChave(): Promise<ChavePixAsaas | null> {
    const pag = await this.leitura.requisicao<{ data: ChavePixAsaas[] }>('GET', '/pix/addressKeys?status=ACTIVE&limit=10', undefined, { semEspera: true });
    return pag.data?.find((k) => !!k.key) ?? null;
  }

  async chaveRecebimento(): Promise<ChaveRecebimentoPix> {
    if (this.simulado) return { simulado: true, disponivel: true, chaveMascarada: null, tipoChave: null, motivo: null };
    try {
      const chave = await this.carregarChave();
      this.chaveEmMemoria = chave;
      if (!chave) {
        return { simulado: false, disponivel: false, chaveMascarada: null, tipoChave: null, motivo: 'A conta no Asaas não tem chave Pix ativa. Cadastre uma chave Pix no painel do Asaas para gerar o Pix das faturas.' };
      }
      return { simulado: false, disponivel: true, chaveMascarada: mascararChavePix(chave.key), tipoChave: chave.type ?? null, motivo: null };
    } catch (e) {
      this.logger.warn(`Não consegui consultar as chaves Pix no Asaas: ${(e as Error).message}`);
      return { simulado: false, disponivel: false, chaveMascarada: null, tipoChave: null, motivo: 'Não foi possível consultar as chaves Pix no Asaas agora. Confira a integração e tente de novo.' };
    }
  }

  // Cobranças que o Asaas criou ao receber um QR estático (filtro `pixQrCodeId`).
  private async pagamentosDoQr(qrId: string): Promise<CobrancaAsaasLida[]> {
    const pag = await this.leitura.requisicao<{ data: CobrancaAsaasLida[] }>('GET', `/payments?pixQrCodeId=${encodeURIComponent(qrId)}&limit=20`);
    return (pag.data ?? []).filter((c) => !c.deleted);
  }

  // ---------------------------------------------------------------
  // Modo COBRANCA (o anterior)
  // ---------------------------------------------------------------
  private async criarPorCobranca(pedido: PedidoPix): Promise<PixCriado> {
    const t0 = Date.now();
    const ms = { cliente: 0, cobranca: 0, qr: 0 };
    const medir = (resultado: string) =>
      this.logger.log(
        `criarPix ${pedido.referencia} (${pedido.valor}c) [cobrança]: ${resultado} em ${Date.now() - t0} ms · cliente ${ms.cliente} ms · POST /payments ${ms.cobranca} ms · GET pixQrCode ${ms.qr} ms`,
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

  // ---------------------------------------------------------------
  // Cancelar e consultar — pelo modo em que o Pix NASCEU
  // ---------------------------------------------------------------
  async cancelarPix(gatewayId: string): Promise<{ cancelado: boolean; pago: boolean }> {
    if (this.simulado || gatewayId.startsWith('pay_sim_') || gatewayId.startsWith(PREFIXO_QR_SIMULADO)) return { cancelado: true, pago: false };
    // Olha ANTES de apagar: Pix pago nunca é removido (regra de 21/10).
    const atual = await this.consultarPix(gatewayId);
    if (atual.pago) return { cancelado: false, pago: true };
    if (ehCobrancaAsaas(gatewayId)) {
      if (!atual.existe) return { cancelado: true, pago: false };
      return { cancelado: await this.asaas.removerCobranca(gatewayId), pago: false };
    }
    try {
      await this.leitura.requisicao('DELETE', `/pix/qrCodes/static/${encodeURIComponent(gatewayId)}`);
      return { cancelado: true, pago: false };
    } catch (e) {
      // O Asaas não tem mais esse QR: já está cancelado.
      if (e instanceof AsaasHttpError && e.status === 404) return { cancelado: true, pago: false };
      this.logger.warn(`Não consegui remover o QR estático ${gatewayId}: ${(e as Error).message}`);
      return { cancelado: false, pago: false };
    }
  }

  async consultarPix(gatewayId: string): Promise<PixConsultado> {
    const nada: PixConsultado = { existe: false, pago: false, valor: 0, dataPagamento: null, pagamentoId: null };
    if (this.simulado || gatewayId.startsWith('pay_sim_') || gatewayId.startsWith(PREFIXO_QR_SIMULADO)) return nada;
    if (!ehCobrancaAsaas(gatewayId)) {
      // QR estático: o pagamento é a cobrança que o Asaas criou ao receber.
      const paga = (await this.pagamentosDoQr(gatewayId)).find((c) => cobrancaAsaasPaga(c.status));
      if (!paga) return { ...nada, existe: true };
      return {
        existe: true,
        pago: true,
        valor: Math.round(paga.value * 100),
        dataPagamento: paga.clientPaymentDate ?? paga.paymentDate ?? paga.confirmedDate ?? null,
        pagamentoId: paga.id,
      };
    }
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

  // ---------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------
  // O pagamento de um QR estático chega como cobrança criada pelo Asaas com
  // `pixQrCodeId`; o de uma cobrança nossa, com a referência `intencao:<id>`.
  // Aviso de Pix SEM referência e sem `pixQrCodeId` também é candidato (o Asaas
  // pode não mandar o campo): quem decide é o worker, perguntando pelo pagamento.
  // Pagamento com referência de OUTRO fluxo (fatura, ativação, acordo…) e
  // pagamento que não é Pix não são deste fluxo → `null`.
  // O pagador que o Asaas registra na cobrança (`customer`) NÃO é lido: pode
  // ser um terceiro, e nada aqui cria ou altera cliente por causa dele.
  interpretarWebhook(corpo: unknown): EventoPix | null {
    const lido = webhookAsaasSchema.safeParse(corpo);
    if (!lido.success) return null;
    const pg = lido.data.payment;
    if (!pg?.id) return null;
    const referencia = intencaoDaReferencia(pg.externalReference) ? pg.externalReference! : null;
    const gatewayId = pg.pixQrCodeId || null;
    if (!referencia && !gatewayId) {
      if (pg.externalReference) return null;
      if (pg.billingType && pg.billingType !== 'PIX') return null;
    }
    return {
      referencia,
      gatewayId,
      pago: lido.data.event === 'PAYMENT_RECEIVED' || lido.data.event === 'PAYMENT_CONFIRMED',
      pagamentoId: pg.id,
      valor: Math.round((pg.value ?? 0) * 100),
      dataPagamento: pg.clientPaymentDate ?? pg.paymentDate ?? pg.confirmedDate ?? null,
      identificadorPix: typeof pg.pixTransaction === 'string' ? pg.pixTransaction : null,
    };
  }

  async pixDoPagamento(pagamentoId: string): Promise<string | null> {
    if (this.simulado) return null;
    const c = await this.leitura.lerCobranca(pagamentoId);
    const qrId = c?.pixQrCodeId;
    return typeof qrId === 'string' && qrId ? qrId : null;
  }

  // Cliente do titular no Asaas (idempotente) — só o modo COBRANCA precisa:
  // id simulado não vale em modo real; cadastro existente é reusado como está
  // (não se altera notificação nem dado nenhum).
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
