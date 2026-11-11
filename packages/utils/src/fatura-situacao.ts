// ============================================================
// Situação da FATURA em runtime (Regra 7: calculada, nunca gravada).
// UMA função para a ficha do titular (mapearFatura), a página pública da
// Fatura Azit (doc 02 §32.2) e qualquer outra tela: ABERTA/FECHADA viram
// "vencida" / "vence_hoje" / "em_aberto" pela data-calendário do vencimento
// comparada ao "hoje" do fuso do negócio (Regra 15); os demais status reais
// (PAGA, PAGA_EM_ATRASO, NOVADA, RESCINDIDA, RENEGOCIADA) passam direto em
// minúsculas.
// ============================================================
export type SituacaoFatura =
  | 'em_aberto'
  | 'vence_hoje'
  | 'vencida'
  | 'paga'
  | 'paga_em_atraso'
  | 'renegociada'
  | 'novada'
  | 'rescindida'
  | (string & {});

export function situacaoFaturaRuntime(status: string, vencimentoISO: string, hojeISO: string): SituacaoFatura {
  const real = status.toLowerCase();
  if (status === 'ABERTA' || status === 'FECHADA') {
    return vencimentoISO < hojeISO ? 'vencida' : vencimentoISO === hojeISO ? 'vence_hoje' : 'em_aberto';
  }
  return real;
}

export function faturaQuitada(status: string): boolean {
  return status === 'PAGA' || status === 'PAGA_EM_ATRASO';
}
