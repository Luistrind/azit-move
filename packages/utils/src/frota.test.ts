import { describe, expect, it } from 'vitest';
import { entradaAVista, FRACAO_ENTRADA_A_VISTA, percentualRetornado } from './calculations';

describe('entradaAVista — 60% à vista quando a entrada é parcelada (doc 02 §4-A.3)', () => {
  it('entrada inteira quando não é parcelada', () => {
    expect(entradaAVista(500_000, false)).toBe(500_000);
  });
  it('60% arredondado ao centavo quando é parcelada', () => {
    expect(FRACAO_ENTRADA_A_VISTA).toBe(0.6);
    expect(entradaAVista(500_000, true)).toBe(300_000);
    expect(entradaAVista(333_333, true)).toBe(200_000);
  });
});

describe('percentualRetornado — retornos gerados sobre o investido (doc 02 §25.7)', () => {
  it('percentual inteiro do investido que já voltou', () => {
    expect(percentualRetornado(3_630_710, 5_385_000)).toBe(67);
    expect(percentualRetornado(6_000_000, 5_385_000)).toBe(111);
  });
  it('sem investimento registrado não há percentual', () => {
    expect(percentualRetornado(100_000, 0)).toBeNull();
  });
  it('nada recebido é zero', () => {
    expect(percentualRetornado(0, 5_385_000)).toBe(0);
  });
});
