import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// 6.7 — Sinistro (Doc 2 §7.8, §8.5). A dívida NÃO é perdoada: a indenização
// amortiza o saldo (não quita automaticamente). Sobra pertence ao cliente;
// saldo remanescente continua obrigação. Aqui aplicamos a indenização cobrindo
// parcelas em aberto inteiras (mais antigas primeiro).
@Injectable()
export class SinistroService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(contratoId: string, valorIndenizacao: number) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }

    const abertas = await this.prisma.db.parcela.findMany({
      where: { contratoId, status: null },
      orderBy: { dataVencimento: 'asc' },
      select: { id: true, valorNominal: true, faturaId: true },
    });

    const hoje = new Date();
    let restante = valorIndenizacao;
    let amortizado = 0;
    let quitadas = 0;

    await this.prisma.db.$transaction(async (tx) => {
      for (const p of abertas) {
        const vn = cent(p.valorNominal);
        if (restante < vn) break; // só cobre parcelas inteiras
        restante -= vn;
        amortizado += vn;
        quitadas += 1;
        await tx.parcela.update({
          where: { id: p.id },
          data: { status: 'PAGA_ANTECIPADA', dataPagamento: hoje, valorPago: reais(vn) },
        });
        await tx.recebivel.updateMany({
          where: { parcelaId: p.id },
          data: { status: 'REALIZADO', dataRealizada: hoje, valorRealizado: reais(vn) },
        });
        if (p.faturaId) {
          await tx.fatura.update({
            where: { id: p.faturaId },
            data: { status: 'PAGA', dataPagamento: hoje, valorPago: reais(vn) },
          });
        }
      }
      const saldoRestante = await tx.parcela.aggregate({
        where: { contratoId, status: null },
        _sum: { valorNominal: true },
      });
      // Saldo zerado -> contrato Quitado; senão permanece (dívida não é perdoada).
      if ((saldoRestante._sum.valorNominal ?? new Prisma.Decimal(0)).equals(0)) {
        await tx.contratoCredito.update({
          where: { id: contratoId },
          data: { status: 'QUITADO_AGUARDANDO_TRANSFERENCIA', dataEncerramento: hoje },
        });
      }
    });

    const saldoRemanescente = abertas
      .slice(quitadas)
      .reduce((s, p) => s + cent(p.valorNominal), 0);
    return {
      amortizado,
      parcelasQuitadas: quitadas,
      saldoRemanescente,
      sobraAoCliente: restante, // indenização não aplicada (< 1 parcela): pertence ao cliente
    };
  }
}
