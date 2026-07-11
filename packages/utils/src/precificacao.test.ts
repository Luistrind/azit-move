import { describe, it, expect } from 'vitest';
import { precificarPrice, TAXA_SEMANAL_PROVISORIA } from './precificacao';

describe('precificarPrice (PROVISÓRIA — Vicente)', () => {
  it('taxa zero: parcela = financiado / n', () => {
    const r = precificarPrice({ valorVenda: 1200000, valorEntrada: 0, prazoSemanas: 12, taxaSemanal: 0 });
    expect(r.valorFinanciado).toBe(1200000);
    expect(r.valorParcela).toBe(100000);
    expect(r.totalParcelado).toBe(1200000);
  });

  it('desconta a entrada do valor de venda', () => {
    const r = precificarPrice({ valorVenda: 5000000, valorEntrada: 1000000, prazoSemanas: 10, taxaSemanal: 0 });
    expect(r.valorFinanciado).toBe(4000000);
    expect(r.valorParcela).toBe(400000);
    expect(r.totalAPagar).toBe(1000000 + 4000000);
  });

  it('Price com juros (taxa explícita): parcela > financiado/n e total > financiado', () => {
    const r = precificarPrice({ valorVenda: 1000000, valorEntrada: 0, prazoSemanas: 10, taxaSemanal: 0.005 });
    expect(r.taxaSemanal).toBe(0.005);
    expect(r.valorParcela).toBeGreaterThan(100000); // juros encarecem
    expect(r.totalParcelado).toBeGreaterThan(1000000);
    expect(r.provisorio).toBe(true);
  });

  it('taxa provisória atualmente ZERADA: parcela = financiado / n (sem juros)', () => {
    expect(TAXA_SEMANAL_PROVISORIA).toBe(0);
    const r = precificarPrice({ valorVenda: 1000000, valorEntrada: 0, prazoSemanas: 10 });
    expect(r.taxaSemanal).toBe(0);
    expect(r.valorParcela).toBe(100000);
    expect(r.totalParcelado).toBe(1000000);
  });

  it('valida prazo inteiro >= 1', () => {
    expect(() => precificarPrice({ valorVenda: 100, valorEntrada: 0, prazoSemanas: 0 })).toThrow();
  });
});

// ============================================================
// Simulação V3 — caso de verificação da planilha do Vicente (HB20S):
// VA 50.000, EN 6.500, 30 meses, CI 3.990, CR 599, TR 2% a.m. → PMT R$ 2.719,42
// ============================================================
import { precificarSimulacao, precificarCreditoAvulso } from './precificacao';

const BASE = {
  valorAvista: 5_000_000,
  valorEntrada: 650_000,
  prazoMeses: 30,
  comissaoInicial: 399_000,
  comissaoRecorrente: 59_900,
  taxaMensal: 0.02,
  fatorPrecificacaoSemanal: 4,
  fatorPrecificacaoQuinzenal: 2,
  fatorSemanal: 4.345,
  fatorQuinzenal: 2.1725,
} as const;

describe('precificarSimulacao (V3 — planilha Vicente)', () => {
  it('reproduz o caso HB20S da planilha (mensal)', () => {
    const r = precificarSimulacao({ ...BASE, frequencia: 'mensal' });
    expect(r.valorParcelamento).toBe(4_749_000); // VP = VA + CI - EN
    expect(r.parcelaMensalBase).toBe(212_042); // PM1
    expect(r.parcelaMensalTotal).toBe(271_942); // PMT = R$ 2.719,42
    expect(r.parcelaFinal).toBe(271_942);
    expect(r.numeroParcelas).toBe(30);
  });

  it('reunião 11/07: PARCELA divide por 4/2 (precificação); Nº DE PARCELAS usa 4,345 (contrato)', () => {
    const semanal = precificarSimulacao({ ...BASE, frequencia: 'semanal' });
    expect(semanal.parcelaFinal).toBe(67_986); // PMT/4 = R$ 679,86 (memória validada na reunião)
    expect(semanal.numeroParcelas).toBe(Math.round(30 * 4.345)); // 130 parcelas
    const quinzenal = precificarSimulacao({ ...BASE, frequencia: 'quinzenal' });
    expect(quinzenal.parcelaFinal).toBe(135_971); // PMT/2 = R$ 1.359,71
    expect(quinzenal.numeroParcelas).toBe(Math.round(30 * 2.1725)); // 65 parcelas
  });

  it('taxa zero: PM1 = VP / PC', () => {
    const r = precificarSimulacao({ ...BASE, taxaMensal: 0, frequencia: 'mensal' });
    expect(r.parcelaMensalBase).toBe(Math.round(4_749_000 / 30));
  });
});

describe('precificarCreditoAvulso', () => {
  it('taxa zero: parcela = financiado / n', () => {
    const r = precificarCreditoAvulso({ valorFinanciado: 300_000, numeroParcelas: 3, taxaMensal: 0, fator: 1 });
    expect(r.valorParcela).toBe(100_000);
  });
  it('com TR 2% a.m. mensal, parcela > financiado/n', () => {
    const r = precificarCreditoAvulso({ valorFinanciado: 300_000, numeroParcelas: 3, taxaMensal: 0.02, fator: 1 });
    expect(r.valorParcela).toBeGreaterThan(100_000);
  });
});
