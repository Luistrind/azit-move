// Situação da conta (doc 02 §27.10 e §33): UMA regra para a grade "Clientes da
// carteira" e para o selo da ficha do titular (Regra 16). Calculada, nunca
// gravada (Regra 7). A ordem importa: sem contrato ativo não é cliente ativo;
// bloqueio vem antes de atraso; atraso antes de acordo.
export type SituacaoConta = 'sem_contrato_ativo' | 'bloqueada' | 'em_atraso' | 'em_acordo' | 'em_dia';

export function situacaoDaConta(p: { contratosAtivos: number; bloqueada: boolean; valorEmAtraso: number; emAcordo: boolean }): SituacaoConta {
  if (p.contratosAtivos === 0) return 'sem_contrato_ativo';
  if (p.bloqueada) return 'bloqueada';
  if (p.valorEmAtraso > 0) return 'em_atraso';
  if (p.emAcordo) return 'em_acordo';
  return 'em_dia';
}
