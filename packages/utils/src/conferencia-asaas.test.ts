import { describe, expect, it } from 'vitest';
import {
  CLASSIFICACOES_CONFERENCIA_ASAAS,
  classificarConferenciaAsaas,
  cobrancaAsaasEstornada,
  contarClassificacoes,
  type CobrancaParaConferir,
} from './conferencia-asaas';

// Conferência Asaas × sistema (doc 02 §27.9, 12/11/2026) — todas as combinações
// de status do Asaas contra uma fatura aberta aqui.
const fatura = { vencimento: '2026-11-05', valor: 99_700 };
const igual = (status: string, extra: Partial<CobrancaParaConferir> = {}): CobrancaParaConferir => ({
  status,
  dueDate: '2026-11-05',
  value: 997,
  deleted: false,
  ...extra,
});

const PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'];
const ABERTOS = ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS', 'DUNNING_REQUESTED'];
const ESTORNOS = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];

describe('classificarConferenciaAsaas', () => {
  it('cobrança sumiu no Asaas (404, deleted ou DELETED) → removida_no_asaas, seja qual for o status', () => {
    expect(classificarConferenciaAsaas(fatura, null)).toBe('removida_no_asaas');
    expect(classificarConferenciaAsaas(fatura, igual('DELETED'))).toBe('removida_no_asaas');
    for (const s of [...PAGOS, ...ABERTOS, ...ESTORNOS]) {
      expect(classificarConferenciaAsaas(fatura, igual(s, { deleted: true }))).toBe('removida_no_asaas');
    }
  });

  it.each(PAGOS)('%s no Asaas com a fatura aberta aqui → paga_no_asaas (mesmo com vencimento/valor diferentes)', (s) => {
    expect(classificarConferenciaAsaas(fatura, igual(s))).toBe('paga_no_asaas');
    expect(classificarConferenciaAsaas(fatura, igual(s, { dueDate: '2026-11-12', value: 1050.5 }))).toBe('paga_no_asaas');
  });

  it.each(ABERTOS)('%s no Asaas, mesmo vencimento e valor → ok', (s) => {
    expect(classificarConferenciaAsaas(fatura, igual(s))).toBe('ok');
  });

  it.each(ABERTOS)('%s no Asaas com vencimento alterado no painel → vencimento_diferente (antes do valor)', (s) => {
    expect(classificarConferenciaAsaas(fatura, igual(s, { dueDate: '2026-11-19' }))).toBe('vencimento_diferente');
    expect(classificarConferenciaAsaas(fatura, igual(s, { dueDate: '2026-11-19', value: 1000 }))).toBe('vencimento_diferente');
  });

  it.each(ABERTOS)('%s no Asaas com valor alterado no painel → valor_diferente', (s) => {
    expect(classificarConferenciaAsaas(fatura, igual(s, { value: 1000 }))).toBe('valor_diferente');
    // centavos: 997,00 × 100 = 99.700 — diferença de 1 centavo já diverge
    expect(classificarConferenciaAsaas(fatura, igual(s, { value: 997.01 }))).toBe('valor_diferente');
  });

  it.each(ESTORNOS)('%s no Asaas → estornada_no_asaas (não é paga nem em aberto)', (s) => {
    expect(cobrancaAsaasEstornada(s)).toBe(true);
    expect(classificarConferenciaAsaas(fatura, igual(s))).toBe('estornada_no_asaas');
  });

  it('status desconhecido do Asaas é tratado como em aberto: compara vencimento e valor', () => {
    expect(classificarConferenciaAsaas(fatura, igual('ALGO_NOVO'))).toBe('ok');
    expect(classificarConferenciaAsaas(fatura, igual('ALGO_NOVO', { value: 1 }))).toBe('valor_diferente');
    expect(cobrancaAsaasEstornada('ALGO_NOVO')).toBe(false);
    expect(cobrancaAsaasEstornada(null)).toBe(false);
  });

  it('valor em reais com fração de centavo arredonda antes de comparar', () => {
    expect(classificarConferenciaAsaas({ vencimento: '2026-11-05', valor: 109_664 }, igual('PENDING', { value: 1096.64 }))).toBe('ok');
  });
});

describe('contarClassificacoes', () => {
  it('conta cada classificação e zera as ausentes (todas as chaves sempre presentes)', () => {
    const r = contarClassificacoes([
      { classificacao: 'ok' },
      { classificacao: 'ok' },
      { classificacao: 'paga_no_asaas' },
      { classificacao: 'removida_no_asaas' },
    ]);
    expect(r).toEqual({ ok: 2, paga_no_asaas: 1, removida_no_asaas: 1, estornada_no_asaas: 0, vencimento_diferente: 0, valor_diferente: 0 });
    expect(Object.keys(r).sort()).toEqual([...CLASSIFICACOES_CONFERENCIA_ASAAS].sort());
  });
});
