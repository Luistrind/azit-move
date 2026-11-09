// Lista de espera (doc 02 §31.3, decisão Luís 2026-11-03): proposta APROVADA sem
// ativo — aprovada por veículo de REFERÊNCIA (FIPE) enquanto não há carro no
// estoque. Situação é CALCULADA (Regra 7); a validade é uma constante única
// (Regra 16), lida por backend e frontend daqui.
import { DIA_MS } from './datas';

/** Dias de validade da aprovação na fila, contados do parecer favorável. */
export const DIAS_VALIDADE_APROVACAO_ESPERA = 60;

export type SituacaoListaEspera = 'na_fila' | 'em_conferencia' | 'pronta' | 'expirada';

export const ROTULO_SITUACAO_ESPERA: Record<SituacaoListaEspera, string> = {
  na_fila: 'Na fila',
  em_conferencia: 'Veículo em conferência',
  pronta: 'Pronta para contrato',
  expirada: 'Aprovação vencida',
};

/** Fim da validade: aprovação + 60 dias (duração em ms — não é "dia" de calendário). */
export function validadeAprovacaoEspera(aprovadaEm: Date): Date {
  return new Date(aprovadaEm.getTime() + DIAS_VALIDADE_APROVACAO_ESPERA * DIA_MS);
}

export function aprovacaoExpirada(aprovadaEm: Date | null, agora: Date = new Date()): boolean {
  return !!aprovadaEm && validadeAprovacaoEspera(aprovadaEm).getTime() < agora.getTime();
}

/**
 * Situação da proposta na lista de espera.
 * - na_fila: aprovada, sem ativo atribuído
 * - em_conferencia: ativo atribuído, analista ainda não confirmou
 * - pronta: ativo conferido — segue para resumo/contrato
 * - expirada: na fila com a aprovação vencida (atribuir exige nova Camada 1)
 */
export function situacaoListaEspera(
  p: { aprovadaEm: Date | null; veiculoAtribuidoEm: Date | null; veiculoConferidoEm: Date | null },
  agora: Date = new Date(),
): SituacaoListaEspera {
  if (p.veiculoConferidoEm) return 'pronta';
  if (p.veiculoAtribuidoEm) return 'em_conferencia';
  if (aprovacaoExpirada(p.aprovadaEm, agora)) return 'expirada';
  return 'na_fila';
}

/** Dias restantes da validade (negativo quando vencida). */
export function diasRestantesAprovacao(aprovadaEm: Date | null, agora: Date = new Date()): number | null {
  if (!aprovadaEm) return null;
  return Math.ceil((validadeAprovacaoEspera(aprovadaEm).getTime() - agora.getTime()) / DIA_MS);
}
