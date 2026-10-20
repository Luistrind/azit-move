import { describe, it, expect } from 'vitest';
import {
  calcularEncargoAtraso,
  DIAS_POR_PERIODO,
  FATOR_PRAZO_QUINZENAL,
  FATOR_PRAZO_SEMANAL,
  FATOR_VALOR_QUINZENAL,
  FATOR_VALOR_SEMANAL,
  fatorPrazoPorFrequencia,
  fatorValorDesdeSemanal,
  fatorValorPorFrequencia,
  normalizarFrequencia,
  parcelasPorPrazoMeses,
  pmtPrice,
  taxaDiariaEquivalente,
  taxaPeriodoEquivalente,
  valorPresenteMensal,
} from './calculations';

// Regra 16 (20/10/2026): estas são as ÚNICAS implementações das fórmulas.
// Os testes abaixo fixam a convenção (taxa MENSAL → diária/periódica
// equivalente, base 30) e os números que os motores por produto compõem.

describe('equivalência de taxas (base mensal 30 dias)', () => {
  it('diária: (1 + tm)^(1/30) − 1', () => {
    expect(taxaDiariaEquivalente(0)).toBe(0);
    expect(taxaDiariaEquivalente(0.02)).toBeCloseTo(Math.pow(1.02, 1 / 30) - 1, 15);
    expect(taxaDiariaEquivalente(0.02)).toBeCloseTo(0.00066, 5);
    // 30 dias à diária reconstroem a mensal
    expect(Math.pow(1 + taxaDiariaEquivalente(0.0199), 30) - 1).toBeCloseTo(0.0199, 12);
  });

  it('por período: semanal/quinzenal/mensal equivalentes à mensal', () => {
    expect(taxaPeriodoEquivalente(0.017, DIAS_POR_PERIODO.mensal)).toBeCloseTo(0.017, 12);
    expect(taxaPeriodoEquivalente(0.017, DIAS_POR_PERIODO.semanal)).toBeCloseTo(Math.pow(1.017, 7 / 30) - 1, 15);
    expect(taxaPeriodoEquivalente(0.017, DIAS_POR_PERIODO.quinzenal)).toBeCloseTo(Math.pow(1.017, 14 / 30) - 1, 15);
    expect(taxaPeriodoEquivalente(0, 7)).toBe(0);
  });
});

describe('valorPresenteMensal — doc 02 §7.4 (VP = VF / (1 + d)^dias, d diária equivalente à mensal)', () => {
  it('sem antecipação (dias 0) ou taxa zero devolve o próprio VF', () => {
    expect(valorPresenteMensal(94_200, 0.02, 0)).toBe(94_200);
    expect(valorPresenteMensal(94_200, 0, 10)).toBe(94_200);
    expect(valorPresenteMensal(94_200, 0.02, -3)).toBe(94_200);
  });

  it('desconta pela diária equivalente (planilha do Vicente): 997,00 a 2% a.m., 7 dias', () => {
    expect(valorPresenteMensal(99_700, 0.02, 7)).toBeCloseTo(99_240.3875, 3);
    // 30 dias = exatamente um mês de desconto
    expect(valorPresenteMensal(102_000, 0.02, 30)).toBeCloseTo(100_000, 6);
  });

  it('devolve fração de centavo — quem compõe arredonda uma vez', () => {
    expect(Number.isInteger(valorPresenteMensal(99_700, 0.2, 45))).toBe(false);
    expect(valorPresenteMensal(99_700, 0.2, 45)).toBeCloseTo(75_844.3597, 3);
  });
});

describe('pmtPrice — Tabela Price', () => {
  it('reproduz o caso HB20S da planilha (PM1 R$ 2.120,42 = Price(47.490; 2%; 30))', () => {
    expect(Math.round(pmtPrice(4_749_000, 0.02, 30))).toBe(212_042);
  });

  it('taxa zero divide; PV zero é zero; n inválido é erro', () => {
    expect(pmtPrice(120_000, 0, 12)).toBe(10_000);
    expect(pmtPrice(0, 0.02, 12)).toBe(0);
    expect(() => pmtPrice(1_000, 0.02, 0)).toThrow(/inteiro/);
    expect(() => pmtPrice(1_000, 0.02, 1.5)).toThrow(/inteiro/);
  });

  it('n parcelas de PMT amortizam exatamente o PV', () => {
    const pv = 1_200_000;
    const i = 0.017;
    const pmt = pmtPrice(pv, i, 12);
    let saldo = pv;
    for (let k = 0; k < 12; k++) saldo = saldo * (1 + i) - pmt;
    expect(saldo).toBeCloseTo(0, 6);
  });
});

describe('fatores de PRAZO e de VALOR — fonte única', () => {
  it('constantes da casa (Catálogo, decisão 02/08)', () => {
    expect(FATOR_PRAZO_SEMANAL).toBe(4.3452);
    expect(FATOR_PRAZO_QUINZENAL).toBe(2.1726);
    expect(FATOR_VALOR_SEMANAL).toBe(4);
    expect(FATOR_VALOR_QUINZENAL).toBe(2);
  });

  it('aceita o enum do banco e a forma da API; rejeita o resto', () => {
    expect(normalizarFrequencia('SEMANAL')).toBe('semanal');
    expect(normalizarFrequencia('quinzenal')).toBe('quinzenal');
    expect(() => normalizarFrequencia('diaria')).toThrow(/desconhecida/);
  });

  it('prazo em meses → nº de parcelas (260 semanais = 60 meses; 65 quinzenais = 30 meses)', () => {
    expect(fatorPrazoPorFrequencia('mensal')).toBe(1);
    expect(parcelasPorPrazoMeses(60, 'semanal')).toBe(261);
    expect(parcelasPorPrazoMeses(30, 'quinzenal')).toBe(65);
    expect(parcelasPorPrazoMeses(24, 'MENSAL')).toBe(24);
    expect(parcelasPorPrazoMeses(30, 'SEMANAL')).toBe(130);
  });

  it('valor: mensal ÷ 4/2/1 para o período e semanal × 1/2/4 de volta', () => {
    expect(fatorValorPorFrequencia('semanal')).toBe(4);
    expect(fatorValorPorFrequencia('QUINZENAL')).toBe(2);
    expect(fatorValorPorFrequencia('mensal')).toBe(1);
    expect(fatorValorDesdeSemanal('semanal')).toBe(1);
    expect(fatorValorDesdeSemanal('quinzenal')).toBe(2);
    expect(fatorValorDesdeSemanal('MENSAL')).toBe(4);
  });
});

describe('calcularEncargoAtraso — Doc 2 §7.2', () => {
  it('sem atraso, encargo zero', () => {
    expect(calcularEncargoAtraso(100000, 0)).toBe(0);
  });

  it('multa 2% + juros 1%/30 ao dia', () => {
    // valor 100000 centavos, 15 dias: multa 2000 + juros 100000*0.01/30*15 = 500
    expect(calcularEncargoAtraso(100000, 15)).toBeCloseTo(2500, 6);
  });
});
