import { describe, it, expect } from 'vitest';
import { imputarPagamento } from './imputacao';

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
