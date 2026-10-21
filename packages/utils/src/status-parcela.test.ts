import { describe, it, expect } from 'vitest';
import { resolverStatusParcela } from './status-parcela';
import { StatusParcela } from '@azit/types';

// "hoje" injetado: o teste não depende do relógio nem do fuso da máquina.
const HOJE = '2026-10-20';

describe('resolverStatusParcela', () => {
  it('status armazenado tem precedência sobre o cálculo', () => {
    expect(
      resolverStatusParcela({ status: StatusParcela.PAGA, dataVencimento: new Date('2026-10-19T00:00:00.000Z'), hoje: HOJE }),
    ).toBe(StatusParcela.PAGA);
  });

  it('null + vencimento hoje => Vence hoje (coluna gravada em UTC-midnight ou 03:00Z)', () => {
    expect(resolverStatusParcela({ status: null, dataVencimento: new Date('2026-10-20T00:00:00.000Z'), hoje: HOJE })).toBe(StatusParcela.VENCE_HOJE);
    expect(resolverStatusParcela({ status: null, dataVencimento: '2026-10-20T03:00:00.000Z', hoje: HOJE })).toBe(StatusParcela.VENCE_HOJE);
  });

  it('null + vencimento passado => Vencida', () => {
    expect(resolverStatusParcela({ status: null, dataVencimento: new Date('2026-10-19T00:00:00.000Z'), hoje: HOJE })).toBe(StatusParcela.VENCIDA);
  });

  it('null + vencimento futuro => Em aberto', () => {
    expect(resolverStatusParcela({ status: null, dataVencimento: new Date('2026-10-21T00:00:00.000Z'), hoje: HOJE })).toBe(StatusParcela.EM_ABERTO);
  });

  it('sem hoje injetado usa o dia do negócio (America/Sao_Paulo), não o relógio local', () => {
    // Só garante que roda e devolve um status calculado válido.
    const r = resolverStatusParcela({ status: null, dataVencimento: new Date('2000-01-01T00:00:00.000Z') });
    expect(r).toBe(StatusParcela.VENCIDA);
  });
});
