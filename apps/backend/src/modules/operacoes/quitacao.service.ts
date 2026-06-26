import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calcularValorPresente, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// 6.6 — Quitação antecipada (Doc 2 §7.4, §8.4). VP = VF/(1+taxa)^tempo por parcela.
@Injectable()
export class QuitacaoService {
  constructor(private readonly prisma: PrismaService) {}

  private hojeUTC(): Date {
    return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  }

  private async carregar(contratoId: string, parcelaIds?: string[]) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, taxaDescontoQuitacao: true },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }
    const where: Prisma.ParcelaWhereInput = { contratoId, status: null };
    if (parcelaIds?.length) where.id = { in: parcelaIds };
    const parcelas = await this.prisma.db.parcela.findMany({
      where,
      orderBy: { numero: 'asc' },
    });
    const taxa = contrato.taxaDescontoQuitacao ? Number(contrato.taxaDescontoQuitacao.toString()) : 0;
    return { contrato, parcelas, taxa };
  }

  async simular(contratoId: string, parcelaIds?: string[]) {
    const { parcelas, taxa } = await this.carregar(contratoId, parcelaIds);
    const hoje = this.hojeUTC();
    let valorNominalTotal = 0;
    let valorQuitacao = 0;
    const detalhe = parcelas.map((p) => {
      const dias = Math.max(0, Math.floor((p.dataVencimento.getTime() - hoje.getTime()) / DIA_MS));
      const vf = cent(p.valorNominal);
      const vp = Math.round(calcularValorPresente(vf, taxa, dias));
      valorNominalTotal += vf;
      valorQuitacao += vp;
      return { id: p.id, display: p.display, valorNominal: vf, valorPresente: vp, diasAteVencimento: dias };
    });
    return {
      parcelas: detalhe,
      valorNominalTotal,
      valorQuitacao,
      desconto: valorNominalTotal - valorQuitacao,
    };
  }

  async quitar(contratoId: string, parcelaIds?: string[]) {
    const sim = await this.simular(contratoId, parcelaIds);
    if (sim.parcelas.length === 0) {
      throw new UnprocessableEntityException({
        erro: 'nada_a_quitar',
        mensagem: 'Não há parcelas em aberto para quitar',
      });
    }
    const hoje = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      for (const p of sim.parcelas) {
        await tx.parcela.update({
          where: { id: p.id },
          data: { status: 'PAGA_ANTECIPADA', dataPagamento: hoje, valorPago: reais(p.valorPresente) },
        });
        await tx.recebivel.updateMany({
          where: { parcelaId: p.id },
          data: { status: 'REALIZADO', dataRealizada: hoje, valorRealizado: reais(p.valorNominal) },
        });
        const parcela = await tx.parcela.findUnique({ where: { id: p.id }, select: { faturaId: true } });
        if (parcela?.faturaId) {
          await tx.fatura.update({
            where: { id: parcela.faturaId },
            data: { status: 'PAGA', dataPagamento: hoje, valorPago: reais(p.valorPresente) },
          });
        }
      }
      // Quitação total -> contrato Quitado (aguardando transferência).
      const restantes = await tx.parcela.count({ where: { contratoId, status: null } });
      if (restantes === 0) {
        await tx.contratoCredito.update({
          where: { id: contratoId },
          data: { status: 'QUITADO_AGUARDANDO_TRANSFERENCIA', dataEncerramento: hoje, motivoEncerramento: 'QUITACAO' },
        });
      }
    });
    return { quitadas: sim.parcelas.length, valorQuitacao: sim.valorQuitacao };
  }
}
