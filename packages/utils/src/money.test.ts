import { describe, it, expect } from 'vitest';
import {
  reaisParaCentavos,
  centavosParaReaisString,
  centavosParaReais,
} from './money';

describe('fronteira monetária centavos <-> reais', () => {
  it('reaisParaCentavos arredonda corretamente', () => {
    expect(reaisParaCentavos(997.0)).toBe(99700);
    expect(reaisParaCentavos('1047.00')).toBe(104700);
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30); // evita 0.30000000000000004
  });

  it('centavosParaReaisString gera string Decimal-safe', () => {
    expect(centavosParaReaisString(99700)).toBe('997.00');
    expect(centavosParaReaisString(104700)).toBe('1047.00');
  });

  it('round-trip preserva o valor', () => {
    expect(reaisParaCentavos(centavosParaReais(99700))).toBe(99700);
  });
});
