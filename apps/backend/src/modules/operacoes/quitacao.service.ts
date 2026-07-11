import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { anteciparParcela, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;
const frac = (d: Prisma.Decimal | null | undefined): number =>
  d !== null && d !== undefined ? Number(d.toString()) : 0;

// 6.6 — Quitação antecipada (Doc 2 §7.4; fórmula da planilha do Vicente, 11/07/2026).
// Cada parcela em aberto separa em CR (comissão recorrente) e PS (capital + remuneração):
//   VP = CR/(1+dcr)^dias + PS/(1+dps)^dias, com d = (1+taxaMensal)^(1/30) − 1 (taxa diária).
// dcr = taxaDescontoAntecipacaoCR da versão de parâmetros (default 20% a.m. — serviço
// distante "isenta" na prática); dps = TR do contrato (a mesma da precificação).
// Contrato sem versão de parâmetros (legado/crédito avulso): CR = 0 e taxa única
// taxaDescontoQuitacao — comportamento anterior preservado.
@Injectable()
export class QuitacaoService {
  constructor(private readonly prisma: PrismaService) {}

  private hojeUTC(): Date {
    return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  }

  private async carregar(contratoId: string, parcelaIds?: string[]) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, taxaDescontoQuitacao: true, periodicidade: true },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }
    const where: Prisma.ParcelaWhereInput = { contratoId, status: null, acordoId: null };
    if (parcelaIds?.length) where.id = { in: parcelaIds };
    const parcelas = await this.prisma.db.parcela.findMany({
      where,
      orderBy: { numero: 'asc' },
    });

    // Versão de parâmetros congelada na simulação que originou o contrato
    // (direto ou como membro do pacote da proposta).
    const proposta = await this.prisma.db.proposta.findFirst({
      where: {
        OR: [{ contratoGeradoId: contratoId }, { contratosPacote: { some: { id: contratoId } } }],
      },
      select: { simulacao: { select: { parametroVersao: true } } },
    });
    const versao = proposta?.simulacao?.parametroVersao ?? null;

    let taxaCR: number;
    let taxaPS: number;
    let crPorParcela: number; // centavos — componente CR embutido em cada parcela
    if (versao) {
      taxaCR = frac(versao.taxaDescontoAntecipacaoCR);
      taxaPS = frac(versao.taxaMensal); // TR
      const fator =
        contrato.periodicidade === 'SEMANAL'
          ? frac(versao.fatorPrecificacaoSemanal)
          : contrato.periodicidade === 'QUINZENAL'
            ? frac(versao.fatorPrecificacaoQuinzenal)
            : 1;
      crPorParcela = fator > 0 ? Math.round(cent(versao.comissaoRecorrente) / fator) : 0;
    } else {
      // Legado: taxa única, sem decomposição de CR.
      taxaCR = 0;
      taxaPS = frac(contrato.taxaDescontoQuitacao);
      crPorParcela = 0;
    }
    return { contrato, parcelas, taxaCR, taxaPS, crPorParcela };
  }

  async simular(contratoId: string, parcelaIds?: string[]) {
    const { parcelas, taxaCR, taxaPS, crPorParcela } = await this.carregar(contratoId, parcelaIds);
    const hoje = this.hojeUTC();
    let valorNominalTotal = 0;
    let valorQuitacao = 0;
    const detalhe = parcelas.map((p) => {
      const dias = Math.max(0, Math.floor((p.dataVencimento.getTime() - hoje.getTime()) / DIA_MS));
      const vf = cent(p.valorNominal);
      const { valorPresente: vp } = anteciparParcela({
        valorNominal: vf,
        componenteCR: crPorParcela,
        dias,
        taxaDescontoCR: taxaCR,
        taxaDescontoPS: taxaPS,
      });
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
      const restantes = await tx.parcela.count({ where: { contratoId, status: null, acordoId: null } });
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
