import { Prisma } from '@prisma/client';
import { formatCurrency } from '@azit/utils';

// Entrada paga A MENOR (decisão Luís 2026-11-15, doc 02 §32.6): pagamento em
// parte existe SÓ dentro das faturas. A entrada do contrato (`ativacao:`), a do
// acordo (`acordo:`) e o recebimento inicial da novação (`novacao:`) só valem
// pelo valor INTEIRO: recebido abaixo disso não ativa nem efetiva nada — o
// recebimento fica registrado e a carteira é avisada para tratar à mão.
//
// O valor chega no job pelo webhook. Job sem valor (simulador de desenvolvimento,
// caminho interno sem cobrança) não passa por esta conferência.

export interface RecebidoNoGateway {
  valorRecebido?: number | null; // centavos
  pagamentoId?: string | null; // id do pagamento no gateway
}

export const ACAO_ENTRADA_A_MENOR = 'entrada_paga_a_menor';

export function entradaPagaAMenor(valorRecebido: number | null | undefined, valorEntrada: number): boolean {
  return typeof valorRecebido === 'number' && valorRecebido < valorEntrada;
}

// Cliente Prisma (estendido ou de transação) — só o que é usado aqui.
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Banco {
  logAuditoria: { findFirst(args: any): Promise<{ id: string } | null>; create(args: { data: Prisma.LogAuditoriaUncheckedCreateInput }): Promise<unknown> };
  notificacao: { create(args: { data: Prisma.NotificacaoUncheckedCreateInput }): Promise<unknown> };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Registra o recebimento (log de auditoria da entidade) e avisa a carteira.
// Idempotente pelo id do pagamento: o gateway pode repetir o aviso (RECEIVED e
// CONFIRMED, reenvio) e a fila pode reprocessar.
export async function registrarEntradaAMenor(
  db: Banco,
  d: {
    entidade: 'contrato_credito' | 'acordo' | 'novacao';
    entidadeId: string;
    oQue: string; // "Entrada do contrato 2026110001", "Entrada do acordo — Fulano"…
    consequencia: string; // o que NÃO aconteceu
    rota: string;
    valorRecebido: number;
    valorEntrada: number;
    pagamentoId?: string | null;
  },
): Promise<{ registrado: boolean }> {
  if (d.pagamentoId) {
    const ja = await db.logAuditoria.findFirst({
      where: { acao: ACAO_ENTRADA_A_MENOR, entidade: d.entidade, entidadeId: d.entidadeId, depois: { path: ['pagamentoId'], equals: d.pagamentoId } },
      select: { id: true },
    });
    if (ja) return { registrado: false };
  }
  await db.logAuditoria.create({
    data: {
      acao: ACAO_ENTRADA_A_MENOR,
      entidade: d.entidade,
      entidadeId: d.entidadeId,
      depois: { valorRecebido: d.valorRecebido, valorEntrada: d.valorEntrada, pagamentoId: d.pagamentoId ?? null },
    },
  });
  await db.notificacao.create({
    data: {
      titulo: `${d.oQue} paga a menor`,
      corpo:
        `Recebidos ${formatCurrency(d.valorRecebido)} de ${formatCurrency(d.valorEntrada)}. ${d.consequencia} ` +
        'Pagamento em parte só vale para fatura: trate o valor recebido com o cliente (complemento ou devolução) e conclua manualmente.',
      rota: d.rota,
      tipo: 'FALHA',
      area: 'CARTEIRA_COBRANCA',
    },
  });
  return { registrado: true };
}
