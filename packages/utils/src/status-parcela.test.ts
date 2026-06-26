import { describe, it, expect } from 'vitest';
import { resolverStatusParcela } from './status-parcela';
import { StatusParcela } from '@azit/types';

describe('resolverStatusParcela', () => {
  it('status armazenado tem precedência sobre o cálculo', () => {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    expect(
      resolverStatusParcela({ status: StatusParcela.PAGA, dataVencimento: ontem }),
    ).toBe(StatusParcela.PAGA);
  });

  it('null + vencimento hoje => Vence hoje', () => {
    expect(
      resolverStatusParcela({ status: null, dataVencimento: new Date() }),
    ).toBe(StatusParcela.VENCE_HOJE);
  });

  it('null + vencimento passado => Vencida', () => {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    expect(
      resolverStatusParcela({ status: null, dataVencimento: ontem }),
    ).toBe(StatusParcela.VENCIDA);
  });

  it('null + vencimento futuro => Em aberto', () => {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    expect(
      resolverStatusParcela({ status: null, dataVencimento: amanha }),
    ).toBe(StatusParcela.EM_ABERTO);
  });
});
