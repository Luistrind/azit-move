import { describe, it, expect } from 'vitest';
import {
  calcularValorPresente,
  calcularQuitacaoTotal,
  calcularEncargoAtraso,
} from './calculations';

describe('calcularValorPresente — VP = VF / (1 + taxa)^tempo', () => {
  it('sem antecipação (tempo 0) retorna o próprio VF', () => {
    expect(calcularValorPresente(99700, 0.033, 0)).toBe(99700);
  });

  it('aplica desconto de valor presente para parcela futura', () => {
    // 99700 / (1.033)^6 ≈ 82254...
    const vp = calcularValorPresente(99700, 0.033, 6);
    expect(vp).toBeLessThan(99700);
    expect(vp).toBeCloseTo(99700 / Math.pow(1.033, 6), 6);
  });

  it('taxa zero não desconta', () => {
    expect(calcularValorPresente(50000, 0, 30)).toBe(50000);
  });
});

describe('calcularQuitacaoTotal', () => {
  it('soma o VP de cada parcela restante', () => {
    const parcelas = [
      { valorFuturo: 99700, diasAteVencimento: 0 },
      { valorFuturo: 99700, diasAteVencimento: 7 },
    ];
    const total = calcularQuitacaoTotal(parcelas, 0.033);
    const esperado =
      99700 + calcularValorPresente(99700, 0.033, 7);
    expect(total).toBeCloseTo(esperado, 6);
  });

  it('conjunto vazio retorna 0', () => {
    expect(calcularQuitacaoTotal([], 0.033)).toBe(0);
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
