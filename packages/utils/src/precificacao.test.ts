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
