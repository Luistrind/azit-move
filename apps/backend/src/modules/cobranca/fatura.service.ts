import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { calcularEncargoAtraso, centavosParaReaisString, imputarPagamento, ItemImputacao } from '@azit/utils';
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
  // Job agendado: fecha as faturas que atingiram o D-5 (diário, madrugada). Em dev
  // o operador também pode disparar via /dev/fechar-faturas.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cronFecharFaturas(): Promise<void> {
    const { fechadas } = await this.fechar();
    if (fechadas) this.logger.log(`[cron] D-5: ${fechadas} fatura(s) fechada(s) → cobrança Asaas`);
  }

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

  // 4.4 — Geração de cobrança no Asaas. O encargo de atraso é nativo do Asaas
  // (multa/juros do contrato): o valor pago no webhook já vem com encargo (opção 2).
  async gerarCobranca(faturaId: string): Promise<void> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: {
        conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } } } },
        parcelas: { include: { contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } }, take: 1 },
      },
    });
    if (!fatura || fatura.asaasChargeId) return;

    // Garante o cliente no Asaas (idempotente).
    const titular = fatura.conta.titular;
    let customerId = titular.asaasCustomerId;
    if (!customerId) {
      customerId = await this.asaas.criarCliente({
        titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp,
      });
      await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    }

    const taxas = fatura.parcelas[0]?.contrato;
    const cobranca = await this.asaas.criarCobranca({
      externalReference: fatura.id,
      valor: cent(fatura.valorTotal),
      vencimento: fatura.dataVencimento,
      descricao: `Fatura ${fatura.numero}`,
      customerId,
      multaPct: taxas ? Number(taxas.taxaMultaAtraso.toString()) : undefined,
      jurosPct: taxas ? Number(taxas.taxaJurosAtraso.toString()) : undefined,
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

    // Pré-cálculo (read-only): encargo por parcela + itens-extra (intermediárias da
    // entrada parcelada + serviços recorrentes da cesta) → total devido.
    const extras = await this.prisma.db.itemFatura.findMany({
      where: { faturaId: fatura.id, tipo: { in: ['INTERMEDIARIA', 'SERVICO'] } },
      select: { id: true, valor: true, tipo: true },
    });
    const calc = fatura.parcelas.map((parcela) => {
      const diasAtraso = Math.max(
        0,
        Math.floor((dataPagamento.getTime() - parcela.dataVencimento.getTime()) / DIA_MS),
      );
      const nominal = cent(parcela.valorNominal);
      const encargo =
        diasAtraso > 0
          ? Math.round(
              calcularEncargoAtraso(
                nominal,
                diasAtraso,
                Number(parcela.contrato.taxaMultaAtraso.toString()),
                Number(parcela.contrato.taxaJurosAtraso.toString()),
              ),
            )
          : 0;
      return { parcela, diasAtraso, nominal, encargo };
    });
    const totalExtras = extras.reduce((s, i) => s + cent(i.valor), 0);
    // Opção 2: o encargo de atraso é nativo do Asaas (multa/juros configurados na
    // cobrança), então NÃO entra na base do que define quitação. A base é o devido
    // "limpo" (principal + serviços/intermediárias); o que o cliente pagar acima
    // disso é o encargo cobrado pelo Asaas. Em dev (valor 0) vai sempre ao integral.
    const baseDevida = calc.reduce((s, c) => s + c.nominal, 0) + totalExtras;

    // Pagamento INSUFICIENTE (cobre menos que a base) → imputação parcial (Doc 2 §7.3).
    if (p.valor > 0 && p.valor < baseDevida) {
      return this.conciliarParcial(fatura.id, calc, extras, dataPagamento, p.valor);
    }

    let valorPagoFatura = 0;
    let algumAtraso = false;
    await this.prisma.db.$transaction(async (tx) => {
      for (const { parcela, diasAtraso, nominal, encargo } of calc) {
        const valorPago = nominal + encargo;
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
            valorRealizado: reais(nominal),
          },
        });
        contratosTocados.add(parcela.contrato.id);
      }

      // Intermediárias + serviços recorrentes liquidam junto com a fatura.
      valorPagoFatura += totalExtras;
      // Quando o webhook traz o valor real (opção 2), ele já inclui o encargo
      // cobrado pelo Asaas — registramos o que de fato entrou. Em dev (valor 0)
      // usamos o computado internamente.
      const valorRegistrado = p.valor > 0 ? p.valor : valorPagoFatura;

      await tx.fatura.update({
        where: { id: fatura.id },
        data: {
          status: algumAtraso ? 'PAGA_EM_ATRASO' : 'PAGA',
          dataPagamento,
          valorPago: reais(valorRegistrado),
        },
      });

      // Status do contrato: quitado se não restam parcelas em aberto; senão, se
      // estava inadimplente e regularizou, volta a Ativo.
      for (const contratoId of contratosTocados) {
        const emAberto = await tx.parcela.count({
          where: { contratoId, status: null, acordoId: null },
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

  // Conciliação de pagamento PARCIAL (Doc 2 §7.3): aplica encargo → serviço →
  // principal. Parcela coberta integralmente é baixada; parcialmente coberta
  // registra o valor e segue em aberto. A fatura não vai a PAGA.
  private async conciliarParcial(
    faturaId: string,
    calc: { parcela: { id: string; contrato: { id: string } }; diasAtraso: number; nominal: number; encargo: number }[],
    extras: { id: string; valor: Prisma.Decimal; tipo: string }[],
    dataPagamento: Date,
    valorPagoCent: number,
  ): Promise<{ resultado: string }> {
    const itens: ItemImputacao[] = [];
    for (const c of calc) if (c.encargo > 0) itens.push({ id: `enc:${c.parcela.id}`, tipo: 'encargo', valor: c.encargo });
    // Serviços recorrentes da cesta entram como 'servico' (prioridade após encargo);
    // intermediárias da entrada parcelada são principal.
    for (const e of extras) itens.push({ id: `extra:${e.id}`, tipo: e.tipo === 'SERVICO' ? 'servico' : 'principal', valor: cent(e.valor) });
    for (const c of calc) itens.push({ id: `prin:${c.parcela.id}`, tipo: 'principal', valor: c.nominal });

    const { alocacoes } = imputarPagamento(valorPagoCent, itens);
    const byId = new Map(alocacoes.map((a) => [a.id, a]));

    await this.prisma.db.$transaction(async (tx) => {
      for (const c of calc) {
        const encAlloc = byId.get(`enc:${c.parcela.id}`)?.alocado ?? 0;
        const prinAlloc = byId.get(`prin:${c.parcela.id}`)?.alocado ?? 0;
        const coberta = prinAlloc >= c.nominal && (c.encargo === 0 || encAlloc >= c.encargo);
        if (coberta) {
          await tx.parcela.update({
            where: { id: c.parcela.id },
            data: {
              status: c.diasAtraso > 0 ? 'PAGA_EM_ATRASO' : 'PAGA',
              dataPagamento,
              valorPago: reais(c.nominal + encAlloc),
              valorEncargo: reais(encAlloc),
            },
          });
          await tx.recebivel.updateMany({
            where: { parcelaId: c.parcela.id },
            data: { status: 'REALIZADO', dataRealizada: dataPagamento, valorRealizado: reais(c.nominal) },
          });
        } else {
          // Parcial: registra o alocado; parcela segue em aberto (status null).
          await tx.parcela.update({
            where: { id: c.parcela.id },
            data: { valorPago: reais(prinAlloc + encAlloc), valorEncargo: reais(encAlloc) },
          });
        }
      }
      // Fatura registra o valor parcial recebido; NÃO é marcada PAGA.
      await tx.fatura.update({ where: { id: faturaId }, data: { valorPago: reais(valorPagoCent) } });
    });

    this.logger.warn(`Conciliação PARCIAL fatura ${faturaId}: recebido ${valorPagoCent}c (imputação encargo→serviço→principal)`);
    return { resultado: 'pago_parcial' };
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

  // Mapeia uma fatura (com itensFatura) para a API; "vencida"/"vence hoje" são
  // calculados em runtime (Regra 7), o status real vai ao banco.
  private mapearFatura(f: {
    id: string; numero: number; periodoReferencia: Date; dataVencimento: Date; dataFechamento: Date | null;
    dataPagamento: Date | null; status: string; valorTotal: Prisma.Decimal; valorPago: Prisma.Decimal | null;
    itensFatura: { descricao: string; tipo: string; valor: Prisma.Decimal; credor: string }[];
  }) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const venc = new Date(f.dataVencimento); venc.setHours(0, 0, 0, 0);
    const statusReal = f.status.toLowerCase();
    let situacao = statusReal;
    if (f.status === 'ABERTA' || f.status === 'FECHADA') {
      situacao = venc < hoje ? 'vencida' : venc.getTime() === hoje.getTime() ? 'vence_hoje' : 'em_aberto';
    }
    return {
      id: f.id,
      numero: f.numero,
      periodoReferencia: f.periodoReferencia.toISOString(),
      dataVencimento: f.dataVencimento.toISOString(),
      dataFechamento: f.dataFechamento?.toISOString() ?? null,
      dataPagamento: f.dataPagamento?.toISOString() ?? null,
      status: statusReal,
      situacao,
      valorTotal: cent(f.valorTotal),
      valorPago: cent(f.valorPago),
      itens: f.itensFatura.map((it) => ({
        descricao: it.descricao,
        tipo: it.tipo.toLowerCase(),
        valor: cent(it.valor),
        credor: it.credor.toLowerCase(),
      })),
    };
  }

  // Visão de faturas do cliente (por conta), paginada — cada fatura agrega itens de
  // todos os contratos/produtos do mesmo ciclo (Doc 2 §372).
  async faturasDaConta(contaId: string, page = 1, limit = 8) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [total, faturas] = await Promise.all([
      this.prisma.db.fatura.count({ where: { contaId } }),
      this.prisma.db.fatura.findMany({
        where: { contaId },
        orderBy: { dataVencimento: 'asc' },
        skip,
        take: limit,
        include: { itensFatura: { orderBy: { tipo: 'asc' } } },
      }),
    ]);
    return { total, page: Math.max(1, page), limit, data: faturas.map((f) => this.mapearFatura(f)) };
  }

  // Detalhe de uma fatura (modal): composição completa + datas + valores.
  async detalheFatura(faturaId: string) {
    const f = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: {
        itensFatura: { orderBy: { tipo: 'asc' } },
        conta: { include: { titular: { select: { id: true, nome: true } } } },
      },
    });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    return { ...this.mapearFatura(f), titular: f.conta.titular };
  }

  // Dev: simula atraso "dia a dia" — cada clique deixa a fatura +N dias vencida.
  // Coloca o vencimento (fatura + parcelas) em hoje-(atrasoAtual+N), de modo que
  // o atraso aumente de forma determinística mesmo partindo de uma fatura futura.
  async envelhecerFatura(faturaId: string, dias = 1) {
    const f = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: { parcelas: { select: { id: true } } },
    });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const v = new Date(f.dataVencimento); v.setHours(0, 0, 0, 0);
    const atrasoAtual = Math.max(0, Math.round((hoje.getTime() - v.getTime()) / DIA_MS));
    const diasAtraso = atrasoAtual + dias;
    const novoVenc = new Date(hoje.getTime() - diasAtraso * DIA_MS);
    const novoFech = new Date(novoVenc.getTime() - 5 * DIA_MS);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.fatura.update({ where: { id: faturaId }, data: { dataVencimento: novoVenc, dataFechamento: novoFech } });
      for (const p of f.parcelas) {
        await tx.parcela.update({ where: { id: p.id }, data: { dataVencimento: novoVenc } });
        await tx.recebivel.updateMany({ where: { parcelaId: p.id }, data: { dataPrevista: novoVenc } });
      }
    });
    return { faturaId, dataVencimento: novoVenc.toISOString(), diasAtraso };
  }
}
