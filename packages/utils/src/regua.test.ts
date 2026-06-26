import { describe, it, expect } from 'vitest';
import { resolverEstagioRegua } from './regua';

describe('resolverEstagioRegua', () => {
  it('retorna null quando ainda em dia (< 1 dia de atraso)', () => {
    expect(resolverEstagioRegua(0)).toBeNull();
    expect(resolverEstagioRegua(-3)).toBeNull();
  });

  it('mapeia os limiares para o estágio correto (pelo maior)', () => {
    expect(resolverEstagioRegua(1)).toBe('D+1');
    expect(resolverEstagioRegua(2)).toBe('D+2');
    expect(resolverEstagioRegua(3)).toBe('D+3');
    expect(resolverEstagioRegua(5)).toBe('D+3'); // entre 3 e 10 segue D+3
    expect(resolverEstagioRegua(10)).toBe('D+10');
    expect(resolverEstagioRegua(11)).toBe('D+10');
    expect(resolverEstagioRegua(12)).toBe('D+12');
    expect(resolverEstagioRegua(40)).toBe('D+12');
  });
});
