import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { centavosParaReaisString, dataHojeBrasil } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { cumprirAcordosSePagos } from './acordo-cumprimento';
import { BaixaContaService } from '../faturamento/baixa-conta.service';
import { ContaFaturaService } from '../faturamento/conta-fatura.service';
import { IntencaoPagamentoService } from '../faturamento/intencao-pagamento.service';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// 6.7 — Sinistro (Doc 2 §7.8, §8.5). A dívida NÃO é perdoada: a indenização
// amortiza o saldo (não quita automaticamente). Sobra pertence ao cliente;
// saldo remanescente continua obrigação. Aqui aplicamos a indenização cobrindo
// parcelas em aberto inteiras (mais antigas primeiro).
@Injectable()
export class SinistroService {
  constructor(
    private readonly prisma: PrismaService,
    // Fatura Azit F2 (doc 02 §32.12 item 12): parcela em fatura AZIT é baixada
    // pelo que FALTA dela, com pagamento registrado na fatura.
    private readonly contaFatura: ContaFaturaService,
    private readonly baixa: BaixaContaService,
    private readonly intencoes: IntencaoPagamentoService,
  ) {}

  async registrar(contratoId: string, valorIndenizacao: number, usuarioId?: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, contaId: true },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }

    const abertas = await this.prisma.db.parcela.findMany({
      where: { contratoId, status: null, acordoId: null },
      orderBy: { dataVencimento: 'asc' },
      select: { id: true, valorNominal: true, valorPago: true, faturaId: true },
    });

    // Parcela em fatura do modelo AZIT (em aberto): a indenização cobre o que
    // FALTA dela (pagamento em parte já abateu), e a baixa fica registrada como
    // pagamento da fatura — que só vira PAGA quando o motor zerar (pode ter
    // parcela de outro contrato ou encargo pendente).
    const diaHoje = dataHojeBrasil();
    const azit = await this.contaFatura.saldosEmAberto(contrato.contaId, diaHoje);
    let tocouFaturaPix = false;

    const hoje = new Date();
    let restante = valorIndenizacao;
    let amortizado = 0;
    let quitadas = 0;

    await this.prisma.db.$transaction(async (tx) => {
      for (const p of abertas) {
        const saldoMotor = azit.porParcela.get(p.id);
        const vn = saldoMotor ? saldoMotor.saldoNominal : cent(p.valorNominal);
        if (restante < vn) break; // só cobre parcelas inteiras
        restante -= vn;
        amortizado += vn;
        quitadas += 1;
        await tx.parcela.update({
          where: { id: p.id },
          // Fatura AZIT: SOMA ao que já tinha sido pago em parte (não regrava).
          data: { status: 'PAGA_ANTECIPADA', dataPagamento: hoje, valorPago: reais(saldoMotor ? cent(p.valorPago) + vn : vn) },
        });
        await tx.recebivel.updateMany({
          where: { parcelaId: p.id },
          data: { status: 'REALIZADO', dataRealizada: hoje, valorRealizado: reais(vn) },
        });
        if (saldoMotor) {
          await this.baixa.baixarParcelaPorOperacao(tx, { contaId: contrato.contaId, parcelaId: p.id, origem: 'SINISTRO', dia: diaHoje });
          tocouFaturaPix = true;
        } else if (p.faturaId) {
          await tx.fatura.update({
            where: { id: p.faturaId },
            data: { status: 'PAGA', dataPagamento: hoje, valorPago: reais(vn) },
          });
        }
      }
      const saldoRestante = await tx.parcela.aggregate({
        where: { contratoId, status: null, acordoId: null },
        _sum: { valorNominal: true },
      });
      // Saldo zerado -> contrato Quitado; senão permanece (dívida não é perdoada).
      if ((saldoRestante._sum.valorNominal ?? new Prisma.Decimal(0)).equals(0)) {
        await tx.contratoCredito.update({
          where: { id: contratoId },
          data: { status: 'ENCERRADO', motivoEncerramento: 'QUITACAO', dataEncerramento: hoje },
        });
      }
    });

    // Gatilho 11 (doc 02, 07/09): o bem sinistrou — a dívida não (Regra 3).
    const c = await this.prisma.db.contratoCredito.findFirst({ where: { id: contratoId }, select: { ativoId: true } });
    if (c?.ativoId) await this.prisma.db.ativo.update({ where: { id: c.ativoId }, data: { status: 'SINISTRADO' } });
    await cumprirAcordosSePagos(this.prisma.db, [contratoId]);
    // O saldo das faturas de Pix sob demanda mudou: os Pix ativos deixam de valer.
    if (tocouFaturaPix) await this.intencoes.invalidarAtivasDaConta(contrato.contaId, 'sinistro registrado');

    const saldoRemanescente = abertas
      .slice(quitadas)
      .reduce((s, p) => s + cent(p.valorNominal), 0);
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'sinistro_registrado',
        entidade: 'contrato',
        entidadeId: contratoId,
        depois: { valorIndenizacao, amortizado, parcelasQuitadas: quitadas, sobraAoCliente: restante },
      },
    });
    return {
      amortizado,
      parcelasQuitadas: quitadas,
      saldoRemanescente,
      sobraAoCliente: restante, // indenização não aplicada (< 1 parcela): pertence ao cliente
    };
  }
}
