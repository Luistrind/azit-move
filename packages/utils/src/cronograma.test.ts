import { describe, it, expect } from 'vitest';
import { gerarCronograma } from './cronograma';

describe('gerarCronograma', () => {
  it('gera n parcelas com display e numeração corretos', () => {
    const c = gerarCronograma({
      numeroParcelas: 3,
      valorParcela: 10000,
      valorTotal: 30000,
      dataPrimeiraParcela: '2026-04-08',
      periodicidade: 'semanal',
    });
    expect(c).toHaveLength(3);
    expect(c.map((p) => p.display)).toEqual(['1/3', '2/3', '3/3']);
    expect(c.map((p) => p.numero)).toEqual([1, 2, 3]);
  });

  it('última parcela absorve o arredondamento: soma == valorTotal', () => {
    // 100000 / 3 não é exato; valorParcela 33333 -> última fecha em 33334
    const c = gerarCronograma({
      numeroParcelas: 3,
      valorParcela: 33333,
      valorTotal: 100000,
      dataPrimeiraParcela: '2026-04-08',
      periodicidade: 'semanal',
    });
    expect(c.map((p) => p.valorNominal)).toEqual([33333, 33333, 33334]);
    expect(c.reduce((s, p) => s + p.valorNominal, 0)).toBe(100000);
  });

  it('periodicidade semanal espaça de 7 em 7 dias', () => {
    const c = gerarCronograma({
      numeroParcelas: 2,
      valorParcela: 5000,
      valorTotal: 10000,
      dataPrimeiraParcela: '2026-04-08',
      periodicidade: 'semanal',
    });
    expect(c[0].dataVencimento.toISOString().slice(0, 10)).toBe('2026-04-08');
    expect(c[1].dataVencimento.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('periodicidade quinzenal espaça de 14 dias; mensal de 1 mês', () => {
    const quinzenal = gerarCronograma({
      numeroParcelas: 2,
      valorParcela: 5000,
      valorTotal: 10000,
      dataPrimeiraParcela: '2026-04-08',
      periodicidade: 'quinzenal',
    });
    expect(quinzenal[1].dataVencimento.toISOString().slice(0, 10)).toBe('2026-04-22');

    const mensal = gerarCronograma({
      numeroParcelas: 3,
      valorParcela: 5000,
      valorTotal: 15000,
      dataPrimeiraParcela: '2026-01-31',
      periodicidade: 'mensal',
    });
    // addMonths normaliza fim de mês (jan 31 -> fev 28)
    expect(mensal[1].dataVencimento.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('n=1 gera uma parcela com o valor total', () => {
    const c = gerarCronograma({
      numeroParcelas: 1,
      valorParcela: 999,
      valorTotal: 50000,
      dataPrimeiraParcela: '2026-04-08',
      periodicidade: 'mensal',
    });
    expect(c).toHaveLength(1);
    expect(c[0].valorNominal).toBe(50000);
    expect(c[0].display).toBe('1/1');
  });

  it('rejeita numeroParcelas inválido', () => {
    expect(() =>
      gerarCronograma({
        numeroParcelas: 0,
        valorParcela: 1,
        valorTotal: 1,
        dataPrimeiraParcela: '2026-04-08',
        periodicidade: 'semanal',
      }),
    ).toThrow();
  });
});
