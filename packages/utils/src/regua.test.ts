import { describe, it, expect } from 'vitest';
import { resolverEstagioRegua, cartoesDaRegua } from './regua';

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

import { resolverRaiaRegua, bloqueioDisponivel, RAIAS_REGUA, DIAS_BLOQUEIO_DISPONIVEL } from './regua';

describe('raias do kanban (decisão 31/10)', () => {
  it('as raias cobrem os dias sem buraco nem sobreposição', () => {
    for (let d = 1; d <= 120; d++) {
      const r = resolverRaiaRegua(d);
      expect(r, `dia ${d}`).not.toBeNull();
      expect(RAIAS_REGUA.filter((x) => x.de >= 1 && d >= x.de && (x.ate === null || d <= x.ate)).length).toBe(1);
    }
  });
  it('limites: 7→até7, 8→até14, 14→até14, 15→até21, 21→até21, 22→até30, 30→até30, 31→até60, 60→até60, 61→mais60', () => {
    expect(resolverRaiaRegua(7)?.chave).toBe('ate7');
    expect(resolverRaiaRegua(8)?.chave).toBe('ate14');
    expect(resolverRaiaRegua(14)?.chave).toBe('ate14');
    expect(resolverRaiaRegua(15)?.chave).toBe('ate21');
    expect(resolverRaiaRegua(21)?.chave).toBe('ate21');
    expect(resolverRaiaRegua(22)?.chave).toBe('ate30');
    expect(resolverRaiaRegua(30)?.chave).toBe('ate30');
    expect(resolverRaiaRegua(31)?.chave).toBe('ate60');
    expect(resolverRaiaRegua(60)?.chave).toBe('ate60');
    expect(resolverRaiaRegua(61)?.chave).toBe('mais60');
    expect(resolverRaiaRegua(400)?.chave).toBe('mais60');
  });
  it('sem atraso: "Vence hoje" só com parcela vencendo hoje; senão null', () => {
    expect(resolverRaiaRegua(0, true)?.chave).toBe('hoje');
    expect(resolverRaiaRegua(0, false)).toBeNull();
    expect(resolverRaiaRegua(3, true)?.chave).toBe('ate7'); // atraso vence o "hoje"
  });
  it('bloqueio disponível a partir da raia "até 14 dias"', () => {
    expect(DIAS_BLOQUEIO_DISPONIVEL).toBe(RAIAS_REGUA.find((r) => r.chave === 'ate14')!.de);
    expect(bloqueioDisponivel(7)).toBe(false);
    expect(bloqueioDisponivel(8)).toBe(true);
    expect(bloqueioDisponivel(45)).toBe(true);
  });
});

describe('cartoesDaRegua — o cliente aparece uma vez por veículo', () => {
  const c = (id: string, contaId: string, temVeiculo: boolean, dias: number, valor: number, faturas: string[], hoje: Partial<{ valor: number; faturas: string[] }> = {}) => ({
    id, contaId, temVeiculo, diasAtraso: dias, valorVencido: valor, parcelasVencidas: faturas.length, faturasVencidas: faturas,
    valorVenceHoje: hoje.valor ?? 0, parcelasVenceHoje: hoje.faturas?.length ?? 0, faturasVenceHoje: hoje.faturas ?? [],
  });

  it('caso Saulo: veículo + Reembolso Parcelado na mesma fatura viram UM cartão, do veículo', () => {
    const r = cartoesDaRegua([c('veic', 'saulo', true, 24, 342000, ['f18', 'f19']), c('rp', 'saulo', false, 24, 28330, ['f18'])]);
    expect(r).toHaveLength(1);
    expect(r[0].principal.id).toBe('veic');
    expect(r[0].juntos.map((j) => j.id)).toEqual(['rp']);
    expect(r[0]).toMatchObject({ diasAtraso: 24, valorVencido: 370330, parcelasVencidas: 3, faturasVencidas: 2 });
  });

  it('o atraso do cartão é o mais antigo da conta, mesmo quando vem do contrato sem veículo', () => {
    const r = cartoesDaRegua([c('veic', 'x', true, 3, 100, ['f2']), c('rp', 'x', false, 12, 50, ['f1'], { valor: 10, faturas: ['f3'] })]);
    expect(r[0]).toMatchObject({ diasAtraso: 12, valorVencido: 150, faturasVencidas: 2, valorVenceHoje: 10, faturasVenceHoje: 1 });
  });

  it('dois veículos na conta: um cartão para cada; o contrato sem veículo soma só no mais atrasado', () => {
    const r = cartoesDaRegua([c('carro1', 'y', true, 5, 100, ['a']), c('carro2', 'y', true, 20, 200, ['b']), c('rp', 'y', false, 5, 30, ['a'])]);
    expect(r.map((k) => [k.principal.id, k.valorVencido, k.juntos.length])).toEqual([['carro1', 100, 0], ['carro2', 230, 1]]);
  });

  it('conta só com contrato sem veículo: um cartão, do mais atrasado; contas diferentes não se misturam', () => {
    const r = cartoesDaRegua([c('rp1', 'z', false, 2, 10, ['a']), c('rp2', 'z', false, 9, 20, ['b']), c('outro', 'w', true, 1, 5, ['c'])]);
    expect(r.map((k) => [k.principal.id, k.valorVencido])).toEqual([['rp2', 30], ['outro', 5]]);
  });
});
