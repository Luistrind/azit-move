import { describe, it, expect } from 'vitest';
import { renderTemplate, numeroPorExtenso, valorPorExtenso, dataPorExtenso } from './templates';

describe('renderTemplate', () => {
  it('substitui placeholders e ignora ausentes', () => {
    expect(renderTemplate('Olá {{nome}}, {{x}}!', { nome: 'Ana' })).toBe('Olá Ana, !');
  });
});

describe('numeroPorExtenso', () => {
  it.each([
    [0, 'zero'],
    [15, 'quinze'],
    [100, 'cem'],
    [123, 'cento e vinte e três'],
    [1000, 'mil'],
    [2024, 'dois mil e vinte e quatro'],
    [1_000_000, 'um milhão'],
  ])('%i -> %s', (n, esperado) => {
    expect(numeroPorExtenso(n)).toBe(esperado);
  });
});

describe('valorPorExtenso', () => {
  it('reais e centavos', () => {
    expect(valorPorExtenso(100)).toBe('um real');
    expect(valorPorExtenso(105000)).toBe('mil e cinquenta reais');
    expect(valorPorExtenso(150)).toBe('um real e cinquenta centavos');
  });
});

describe('dataPorExtenso', () => {
  it('formata em UTC', () => {
    expect(dataPorExtenso('2026-06-08')).toBe('8 de junho de 2026');
  });
});
