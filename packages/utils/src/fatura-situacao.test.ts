import { describe, it, expect } from 'vitest';
import { situacaoFaturaRuntime, faturaQuitada } from './fatura-situacao';
import { detalharEncargoAtraso, calcularEncargoAtraso } from './calculations';
import { mascararDocumento, primeiroNome } from './formatters';

describe('situacaoFaturaRuntime (Regra 7)', () => {
  it('ABERTA/FECHADA derivam da data', () => {
    expect(situacaoFaturaRuntime('ABERTA', '2026-11-16', '2026-11-11')).toBe('em_aberto');
    expect(situacaoFaturaRuntime('FECHADA', '2026-11-11', '2026-11-11')).toBe('vence_hoje');
    expect(situacaoFaturaRuntime('FECHADA', '2026-11-02', '2026-11-11')).toBe('vencida');
  });
  it('status reais passam direto', () => {
    expect(situacaoFaturaRuntime('PAGA', '2026-11-02', '2026-11-11')).toBe('paga');
    expect(situacaoFaturaRuntime('PAGA_EM_ATRASO', '2026-11-02', '2026-11-11')).toBe('paga_em_atraso');
    expect(situacaoFaturaRuntime('NOVADA', '2026-11-02', '2026-11-11')).toBe('novada');
  });
  it('faturaQuitada', () => {
    expect(faturaQuitada('PAGA')).toBe(true);
    expect(faturaQuitada('PAGA_EM_ATRASO')).toBe(true);
    expect(faturaQuitada('FECHADA')).toBe(false);
  });
});

describe('detalharEncargoAtraso (doc 02 §7.2 em duas linhas)', () => {
  it('multa 2% única + atualização 1% a.m. pro-rata; soma = calcularEncargoAtraso', () => {
    const d = detalharEncargoAtraso(104_900, 7, 2, 1);
    expect(d.multa).toBeCloseTo(2098, 5);
    expect(d.atualizacao).toBeCloseTo((104_900 * 0.01 / 30) * 7, 5);
    expect(d.total).toBeCloseTo(calcularEncargoAtraso(104_900, 7, 2, 1), 5);
  });
  it('sem atraso: zero', () => {
    expect(detalharEncargoAtraso(104_900, 0)).toEqual({ multa: 0, atualizacao: 0, total: 0 });
  });
});

describe('mascararDocumento / primeiroNome (página pública, §32.2)', () => {
  it('CPF e CNPJ mascarados; outros viram ***', () => {
    expect(mascararDocumento('123.456.789-01')).toBe('***.456.789-**');
    expect(mascararDocumento('12345678000199')).toBe('**.345.678/0001-**');
    expect(mascararDocumento('123')).toBe('***');
  });
  it('primeiro nome com inicial maiúscula', () => {
    expect(primeiroNome('CARLOS EDUARDO SILVA')).toBe('Carlos');
    expect(primeiroNome('  ana ')).toBe('Ana');
    expect(primeiroNome('')).toBe('');
  });
});
