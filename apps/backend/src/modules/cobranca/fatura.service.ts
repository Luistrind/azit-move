import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { calcularEncargoAtraso, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { QUEUE_NAMES } from '../queues/queues.module';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (centavos: number) => centavosParaReaisString(centavos);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

export interface WebhookPagamento {
  faturaId: string; // externalReference
  paymentDate: string;
  dueDate: string;
  valor: number; // centavos (informativo; o sistema recalcula)
}

@Injectable()
export class FaturaService {
  private readonly logger = new Logger(FaturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    @InjectQueue(QUEUE_NAMES.GERAR_COBRANCA_ASAAS)
    private readonly filaCobranca: Queue,
  ) {}

  // 4.2 — Fechamento D-5: fatura ABERTA cujo dataFechamento chegou fecha e
  // dispara a geração de cobrança no Asaas.
  async fechar(referencia: Date = new Date()): Promise<{ fechadas: number }> {
    const aFechar = await this.prisma.db.fatura.findMany({
      where: { status: 'ABERTA', dataFechamento: { lte: referencia } },
      select: { id: true },
    });
    for (const f of aFechar) {
      await this.prisma.db.fatura.update({
        where: { id: f.id },
        data: { status: 'FECHADA' },
      });
      await this.filaCobranca.add('gerar', { faturaId: f.id });
    }
    return { fechadas: aFechar.length };
  }

  // 4.4 — Geração de cobrança no Asaas (modo simulado por padrão).
  async gerarCobranca(faturaId: string): Promise<void> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
    });
    if (!fatura || fatura.asaasChargeId) return;

    const cobranca = await this.asaas.criarCobranca({
      externalReference: fatura.id,
      valor: cent(fatura.valorTotal),
      vencimento: fatura.dataVencimento,
      descricao: `Fatura ${fatura.numero}`,
    });
    await this.prisma.db.fatura.update({
      where: { id: fatura.id },
      data: { asaasChargeId: cobranca.id },
    });
  }

  // 4.6 + 4.7 — Conciliação de pagamento. Baixa fatura + parcelas, calcula
  // encargo de atraso (independente do Asaas) e realiza os recebíveis.
  async conciliarPagamento(p: WebhookPagamento): Promise<{ resultado: string }> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: p.faturaId },
      include: {
        parcelas: {
          include: {
            contrato: {
              select: { id: true, status: true, taxaMultaAtraso: true, taxaJurosAtraso: true },
            },
          },
        },
      },
    });
    if (!fatura) {
      this.logger.warn(`Conciliação: fatura ${p.faturaId} não encontrada`);
      return { resultado: 'fatura_nao_encontrada' };
    }
    if (fatura.status === 'PAGA' || fatura.status === 'PAGA_EM_ATRASO') {
      return { resultado: 'ja_conciliada' };
    }

    const dataPagamento = new Date(p.paymentDate);
    const contratosTocados = new Set<string>();
    let valorPagoFatura = 0;
    let algumAtraso = false;

    await this.prisma.db.$transaction(async (tx) => {
      for (const parcela of fatura.parcelas) {
        const diasAtraso = Math.max(
          0,
          Math.floor((dataPagamento.getTime() - parcela.dataVencimento.getTime()) / DIA_MS),
        );
        const valorNominal = cent(parcela.valorNominal);
        const encargo =
          diasAtraso > 0
            ? Math.round(
                calcularEncargoAtraso(
                  valorNominal,
                  diasAtraso,
                  Number(parcela.contrato.taxaMultaAtraso.toString()),
                  Number(parcela.contrato.taxaJurosAtraso.toString()),
                ),
              )
            : 0;
        const valorPago = valorNominal + encargo;
        valorPagoFatura += valorPago;
        if (diasAtraso > 0) algumAtraso = true;

        await tx.parcela.update({
          where: { id: parcela.id },
          data: {
            status: diasAtraso > 0 ? 'PAGA_EM_ATRASO' : 'PAGA',
            dataPagamento,
            valorPago: reais(valorPago),
            valorEncargo: reais(encargo),
          },
        });
        // Recebível realizado (breakdown segue placeholder).
        await tx.recebivel.updateMany({
          where: { parcelaId: parcela.id },
          data: {
            status: 'REALIZADO',
            dataRealizada: dataPagamento,
            valorRealizado: reais(valorNominal),
          },
        });
        contratosTocados.add(parcela.contrato.id);
      }

      await tx.fatura.update({
        where: { id: fatura.id },
        data: {
          status: algumAtraso ? 'PAGA_EM_ATRASO' : 'PAGA',
          dataPagamento,
          valorPago: reais(valorPagoFatura),
        },
      });

      // Status do contrato: quitado se não restam parcelas em aberto; senão, se
      // estava inadimplente e regularizou, volta a Ativo.
      for (const contratoId of contratosTocados) {
        const emAberto = await tx.parcela.count({
          where: { contratoId, status: null },
        });
        if (emAberto === 0) {
          await tx.contratoCredito.update({
            where: { id: contratoId },
            data: { status: 'QUITADO_AGUARDANDO_TRANSFERENCIA' },
          });
        } else {
          const c = fatura.parcelas.find((x) => x.contrato.id === contratoId)?.contrato;
          if (c?.status === 'INADIMPLENTE') {
            await tx.contratoCredito.update({
              where: { id: contratoId },
              data: { status: 'ATIVO' },
            });
          }
        }
      }
    });

    return { resultado: algumAtraso ? 'pago_em_atraso' : 'pago' };
  }

  // PAYMENT_OVERDUE: fatura -> Vencida, contrato -> Inadimplente. A régua de
  // cobrança em si é o Bloco 5 (aqui só marcamos os estados).
  async marcarVencida(faturaId: string): Promise<{ resultado: string }> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: { parcelas: { select: { contratoId: true } } },
    });
    if (!fatura) return { resultado: 'fatura_nao_encontrada' };
    if (fatura.status === 'PAGA' || fatura.status === 'PAGA_EM_ATRASO') {
      return { resultado: 'ja_paga' };
    }
    await this.prisma.db.fatura.update({
      where: { id: fatura.id },
      data: { status: 'VENCIDA' },
    });
    const contratoIds = [...new Set(fatura.parcelas.map((p) => p.contratoId))];
    for (const contratoId of contratoIds) {
      await this.prisma.db.contratoCredito.update({
        where: { id: contratoId },
        data: { status: 'INADIMPLENTE' },
      });
    }
    return { resultado: 'vencida' };
  }

  // 4.9 — Extrato: eventos de pagamento conciliados do contrato.
  async extrato(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, dataAssinatura: true },
    });
    if (!contrato) return [];

    const pagas = await this.prisma.db.parcela.findMany({
      where: { contratoId, dataPagamento: { not: null } },
      orderBy: { dataPagamento: 'desc' },
      select: {
        display: true,
        dataPagamento: true,
        valorPago: true,
        valorEncargo: true,
        status: true,
      },
    });

    const eventos = pagas.map((p) => ({
      tipo: 'pagamento' as const,
      label: `Pagamento parcela ${p.display}`,
      data: p.dataPagamento!.toISOString(),
      valor: cent(p.valorPago),
      encargo: cent(p.valorEncargo),
      atraso: p.status === 'PAGA_EM_ATRASO',
    }));

    eventos.push({
      tipo: 'pagamento',
      label: `Contrato ${contrato.numero} originado`,
      data: contrato.dataAssinatura.toISOString(),
      valor: 0,
      encargo: 0,
      atraso: false,
    });

    return eventos;
  }
}
