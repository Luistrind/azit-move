import { describe, expect, it } from 'vitest';
import { situacaoDaConta } from './conta-situacao';

describe('situacaoDaConta — uma regra para a carteira e para a ficha', () => {
  const base = { contratosAtivos: 1, bloqueada: false, valorEmAtraso: 0, emAcordo: false };
  it('sem contrato ativo vence tudo', () => {
    expect(situacaoDaConta({ ...base, contratosAtivos: 0, bloqueada: true, valorEmAtraso: 100 })).toBe('sem_contrato_ativo');
  });
  it('bloqueio vem antes de atraso, atraso antes de acordo', () => {
    expect(situacaoDaConta({ ...base, bloqueada: true, valorEmAtraso: 100, emAcordo: true })).toBe('bloqueada');
    expect(situacaoDaConta({ ...base, valorEmAtraso: 100, emAcordo: true })).toBe('em_atraso');
    expect(situacaoDaConta({ ...base, emAcordo: true })).toBe('em_acordo');
  });
  it('nada pendente é em dia', () => {
    expect(situacaoDaConta(base)).toBe('em_dia');
  });
});
