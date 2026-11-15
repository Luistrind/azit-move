import { describe, it, expect } from 'vitest';
import { imputarEmNiveis, imputarPagamento } from './imputacao';

describe('imputarPagamento (Doc §7.3: encargo → serviço → principal)', () => {
  const itens = [
    { id: 'p', tipo: 'principal' as const, valor: 100000 },
    { id: 'e', tipo: 'encargo' as const, valor: 2000 },
    { id: 's', tipo: 'servico' as const, valor: 5000 },
  ];

  it('pagamento insuficiente cobre encargo, depois serviço, depois principal', () => {
    const { alocacoes } = imputarPagamento(3000, itens);
    const por = Object.fromEntries(alocacoes.map((a) => [a.tipo, a]));
    expect(por.encargo.alocado).toBe(2000); // encargo coberto primeiro
    expect(por.servico.alocado).toBe(1000); // sobra vai pro serviço
    expect(por.principal.alocado).toBe(0); // principal por último
  });

  it('pagamento integral cobre tudo, sem sobra', () => {
    const { alocacoes, sobra } = imputarPagamento(107000, itens);
    expect(alocacoes.every((a) => a.saldo === 0)).toBe(true);
    expect(sobra).toBe(0);
  });

  it('pagamento acima do devido gera sobra (troco)', () => {
    const { sobra } = imputarPagamento(110000, itens);
    expect(sobra).toBe(3000);
  });
});

describe('imputarEmNiveis (doc 02 §32.5: cascata com rateio proporcional no nível)', () => {
  it('quita os níveis em ordem e rateia quando o dinheiro acaba no meio de um', () => {
    const { alocacoes, sobra } = imputarEmNiveis(20000, [
      { id: 'principal', nivel: 4, saldo: 69900 },
      { id: 'protecao', nivel: 2, saldo: 5000 },
      { id: 'reemb', nivel: 3, saldo: 12000 },
      { id: 'acordo', nivel: 3, saldo: 18000 },
    ]);
    expect(alocacoes.map((a) => [a.id, a.alocado, a.saldo])).toEqual([
      ['protecao', 5000, 0],
      ['reemb', 6000, 6000],
      ['acordo', 9000, 9000],
      ['principal', 0, 69900],
    ]);
    expect(sobra).toBe(0);
  });

  it('o último item com saldo absorve o centavo; item zerado no nível não recebe nada', () => {
    const { alocacoes } = imputarEmNiveis(100, [
      { id: 'a', nivel: 1, saldo: 1000 },
      { id: 'b', nivel: 1, saldo: 1000 },
      { id: 'c', nivel: 1, saldo: 1000 },
      { id: 'zerado', nivel: 1, saldo: 0 },
    ]);
    expect(alocacoes.map((a) => a.alocado)).toEqual([33, 33, 34, 0]);
  });

  it('pagamento acima do devido devolve a sobra', () => {
    expect(imputarEmNiveis(5000, [{ id: 'a', nivel: 1, saldo: 3000 }]).sobra).toBe(2000);
  });
});
