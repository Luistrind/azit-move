import { describe, expect, it } from 'vitest';
import type { VisaoMensal } from './carteira-visao';
import { escoamentoDaCarteira, pontosDaCarteira, simularVendasNovas, ticketMedioMensal } from './carteira-tempo';

// Só os campos que as leituras usam — o resto da visão mensal não entra na conta.
function mes(m: string, teto: number, o: Partial<{ pago: number; vencido: number; aVencer: number; recebido: number; faturas: number; clientes: number; produtos: [string, number][] }> = {}): VisaoMensal {
  return {
    mes: m,
    teto: { valor: teto, faturas: o.faturas ?? 4, clientes: o.clientes ?? 2 },
    pagas: { valor: o.pago ?? 0, faturas: 0, clientes: 0, valorPago: o.pago ?? 0 },
    vencidas: { valor: o.vencido ?? 0, faturas: 0, clientes: 0 },
    aVencer: { valor: o.aVencer ?? 0, faturas: 0, clientes: 0 },
    recebido: { valor: o.recebido ?? 0 },
    porProduto: (o.produtos ?? []).map(([chave, t]) => ({ chave, rotulo: chave.toUpperCase(), teto: t })),
  } as unknown as VisaoMensal;
}
const mapa = (lista: VisaoMensal[]) => new Map(lista.map((x) => [x.mes, x]));

describe('pontosDaCarteira', () => {
  const dados = mapa([
    mes('2026-11', 1000, { pago: 600, vencido: 100, aVencer: 300, recebido: 650, faturas: 5, clientes: 3, produtos: [['cp', 900], ['prot', 100]] }),
    mes('2026-12', 800, { aVencer: 800, faturas: 4, clientes: 3, produtos: [['cp', 700], ['prot', 100]] }),
    mes('2027-02', 500, { aVencer: 500, faturas: 2, clientes: 2, produtos: [['cp', 450], ['rp', 50]] }),
  ]);
  const janela = ['2026-11', '2026-12', '2027-01', '2027-02'];

  it('por mês: um ponto por mês da janela, mês sem fatura zerado', () => {
    const p = pontosDaCarteira(janela, dados, 'mes');
    expect(p.map((x) => [x.chave, x.teto, x.clientes])).toEqual([['2026-11', 1000, 3], ['2026-12', 800, 3], ['2027-01', 0, 0], ['2027-02', 500, 2]]);
    expect(p[0]).toMatchObject({ pago: 600, vencido: 100, aVencer: 300, recebido: 650, faturas: 5 });
  });

  it('os produtos saem na mesma ordem em todos os pontos, com zero onde não há', () => {
    const p = pontosDaCarteira(janela, dados, 'mes');
    expect(p.map((x) => x.porProduto.map((q) => [q.chave, q.teto]))).toEqual([
      [['cp', 900], ['prot', 100], ['rp', 0]],
      [['cp', 700], ['prot', 100], ['rp', 0]],
      [['cp', 0], ['prot', 0], ['rp', 0]],
      [['cp', 450], ['prot', 0], ['rp', 50]],
    ]);
  });

  it('por trimestre: soma os meses do trimestre civil e não soma clientes', () => {
    const p = pontosDaCarteira(janela, dados, 'trimestre');
    expect(p.map((x) => [x.chave, x.meses, x.teto, x.faturas, x.clientes])).toEqual([
      ['2026-T4', ['2026-11', '2026-12'], 1800, 9, null],
      ['2027-T1', ['2027-01', '2027-02'], 500, 2, null],
    ]);
    expect(p[0].porProduto.find((q) => q.chave === 'cp')?.teto).toBe(1600);
  });
});

describe('escoamentoDaCarteira', () => {
  it('acha o pico, o primeiro mês depois dele abaixo de 75% e o último vencimento', () => {
    const serie = [['2026-10', 700], ['2026-11', 900], ['2026-12', 1000], ['2027-01', 800], ['2027-02', 740], ['2027-03', 300], ['2027-04', 0]].map(([m, t]) => ({ mes: m as string, teto: t as number }));
    expect(escoamentoDaCarteira(serie)).toEqual({ pico: { mes: '2026-12', teto: 1000 }, limite: 750, abaixo: '2027-02', ultimo: '2027-03' });
  });
  it('mês abaixo do limite ANTES do pico não conta; sem fatura, não há escoamento', () => {
    expect(escoamentoDaCarteira([{ mes: '2026-01', teto: 100 }, { mes: '2026-02', teto: 1000 }])?.abaixo).toBeNull();
    expect(escoamentoDaCarteira([{ mes: '2026-01', teto: 0 }])).toBeNull();
  });
});

describe('simulação de vendas novas', () => {
  it('ticket: fatura média por cliente nos três próximos meses cheios', () => {
    const serie = [
      { mes: '2026-11', teto: 99999, clientes: 1 }, // mês em curso não entra
      { mes: '2026-12', teto: 400000, clientes: 100 },
      { mes: '2027-01', teto: 400000, clientes: 100 },
      { mes: '2027-02', teto: 500000, clientes: 100 },
      { mes: '2027-03', teto: 900000, clientes: 100 }, // quarto mês não entra
    ];
    expect(ticketMedioMensal(serie, '2026-11')).toBe(4333);
    expect(ticketMedioMensal([], '2026-11')).toBe(0);
  });

  it('cresce um lote por mês a partir do mês seguinte e estabiliza no prazo', () => {
    const meses = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
    expect(simularVendasNovas(meses, '2026-11', 2, 1000, 3)).toEqual([0, 0, 2000, 4000, 6000, 6000]);
    expect(simularVendasNovas(meses, '2026-11', 0, 1000)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
