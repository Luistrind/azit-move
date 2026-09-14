import { describe, it, expect } from 'vitest';
import {
  decomporSaldoNovacao,
  ratearProporcional,
  reconstituirDividaAcordo,
  valorarComponenteNovacao,
  ComponenteNovacao,
} from './novacao';

// F1 da Novação (docs/novacao-adaptacoes-azit-2026-09.md, A7 passos 1–2):
// vencido = saldo + 2% multa + 1% a.m. pró-rata; futuro do veículo a VP pela
// taxa de origem; seguro futuro NUNCA entra; acordo explode pela composição
// com juros em PARTES IGUAIS entre os produtos.

describe('valorarComponenteNovacao', () => {
  it('vencido: multa 2% + mora 1% a.m. pró-rata base 30 (RAP007/A7)', () => {
    // 100,00 com 15 dias: 2,00 de multa + 100×1%×(15/30) = 0,50 → 102,50
    const r = valorarComponenteNovacao({
      origem: 'x', valorNominal: 10000, situacao: 'vencido', dias: 15,
    });
    expect(r.valor).toBe(10250);
    expect(r.ajuste).toBe(250);
  });

  it('vencido herda as taxas do contrato quando informadas', () => {
    const r = valorarComponenteNovacao({
      origem: 'x', valorNominal: 10000, situacao: 'vencido', dias: 30,
      taxaMultaPercent: 10, taxaJurosMensalPercent: 3,
    });
    // 10% multa (1000) + 3% em 30 dias (300)
    expect(r.valor).toBe(11300);
  });

  it('futuro: valor presente pela taxa mensal de origem (VF/(1+d)^dias)', () => {
    // 30 dias à taxa 1,6% a.m.: VP = 10000/1.016 = 9842,51... → 9843
    const r = valorarComponenteNovacao({
      origem: 'x', valorNominal: 10000, situacao: 'futuro', dias: 30, taxaVpMensal: 0.016,
    });
    expect(r.valor).toBe(9843);
    expect(r.ajuste).toBe(-157);
  });

  it('futuro sem taxa entra pelo nominal', () => {
    const r = valorarComponenteNovacao({ origem: 'x', valorNominal: 10000, situacao: 'futuro', dias: 60 });
    expect(r.valor).toBe(10000);
  });
});

describe('ratearProporcional (maior-resto: a soma SEMPRE fecha)', () => {
  it('rateia na proporção dos pesos', () => {
    expect(ratearProporcional(13000, [7000, 3000, 3000])).toEqual([7000, 3000, 3000]);
  });
  it('resíduo vai para as maiores frações', () => {
    const r = ratearProporcional(100, [1, 1, 1]);
    expect(r.reduce((s, x) => s + x, 0)).toBe(100);
    expect(r).toEqual([34, 33, 33]);
  });
  it('pesos zerados caem em partes iguais', () => {
    expect(ratearProporcional(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });
});

describe('reconstituirDividaAcordo (juros do acordo em PARTES IGUAIS)', () => {
  it('encargos divididos igualmente entre os produtos da composição', () => {
    // Cobriu 60 veículo + 20 seguro + 20 reembolso; plano de 130 → encargos 30
    // divididos em 3 partes de 10: dívidas 70/30/30.
    const r = reconstituirDividaAcordo(
      [
        { produto: 'veiculo', valorNominal: 6000 },
        { produto: 'seguro', valorNominal: 2000 },
        { produto: 'reembolso', valorNominal: 2000 },
      ],
      13000,
    );
    expect(r).toEqual([
      { produto: 'veiculo', dividaOriginal: 7000 },
      { produto: 'seguro', dividaOriginal: 3000 },
      { produto: 'reembolso', dividaOriginal: 3000 },
    ]);
  });

  it('mesmo produto em várias parcelas agrega antes da divisão', () => {
    const r = reconstituirDividaAcordo(
      [
        { produto: 'veiculo', valorNominal: 3000 },
        { produto: 'veiculo', valorNominal: 3000 },
        { produto: 'seguro', valorNominal: 4000 },
      ],
      12000,
    );
    // nominal 10000, encargos 2000 ÷ 2 produtos = 1000 cada
    expect(r).toEqual([
      { produto: 'veiculo', dividaOriginal: 7000 },
      { produto: 'seguro', dividaOriginal: 5000 },
    ]);
  });
});

describe('decomporSaldoNovacao', () => {
  const vencidoVeiculo: ComponenteNovacao = {
    origem: 'Parcela 10/209', produto: 'veiculo', situacao: 'vencido', dias: 30, valorNominal: 10000,
  };

  it('separa parte do veículo dos demais produtos', () => {
    const r = decomporSaldoNovacao({
      componentes: [
        vencidoVeiculo, // → 10000 + 200 + 100 = 10300
        { origem: 'Parcela 11/209', produto: 'veiculo', situacao: 'futuro', dias: 30, valorNominal: 10000, taxaVpMensal: 0.016 }, // → 9843
        { origem: 'Proteção', produto: 'seguro', situacao: 'vencido', dias: 30, valorNominal: 5000 }, // → 5150
        { origem: 'Reembolso 2/10', produto: 'reembolso', situacao: 'futuro', dias: 60, valorNominal: 8000, taxaVpMensal: 0.015 }, // 8000/(1.015²)=7765
      ],
      acordos: [],
    });
    expect(r.parteVeiculo).toEqual({ vencido: 10300, futuro: 9843, deAcordos: 0, total: 20143 });
    expect(r.demaisProdutos.porProduto).toEqual([
      { produto: 'reembolso', vencido: 0, futuro: 7765, deAcordos: 0, total: 7765 },
      { produto: 'seguro', vencido: 5150, futuro: 0, deAcordos: 0, total: 5150 },
    ]);
    expect(r.totalGeral).toBe(20143 + 7765 + 5150);
  });

  it('seguro FUTURO nunca entra (A3) e fica auditado em ignorados', () => {
    const r = decomporSaldoNovacao({
      componentes: [
        vencidoVeiculo,
        { origem: 'Proteção futura', produto: 'seguro', situacao: 'futuro', dias: 7, valorNominal: 3000 },
      ],
      acordos: [],
    });
    expect(r.demaisProdutos.total).toBe(0);
    expect(r.memoria.ignorados).toHaveLength(1);
    expect(r.memoria.ignorados[0].valorNominal).toBe(3000);
  });

  it('acordo explode: saldo aberto rateado pela dívida reconstituída por produto', () => {
    const r = decomporSaldoNovacao({
      componentes: [],
      acordos: [
        {
          acordoId: 'A',
          // Cobriu 60 veículo + 20 seguro + 20 reembolso; plano 130 → dívidas 70/30/30.
          composicao: [
            { produto: 'veiculo', valorNominal: 6000 },
            { produto: 'seguro', valorNominal: 2000 },
            { produto: 'reembolso', valorNominal: 2000 },
          ],
          valorItens: 13000,
          // Restam 2 parcelas em aberto do plano: uma vencida há 30d (52 → 53,56)
          // e uma futura pelo nominal (52).
          parcelasAbertas: [
            { origem: 'Acordo 3/5', situacao: 'vencido', dias: 30, valorNominal: 5200 },
            { origem: 'Acordo 4/5', situacao: 'futuro', dias: 30, valorNominal: 5200 },
          ],
        },
      ],
    });
    const a = r.memoria.acordos[0];
    // vencida: 5200 + 104 + 52 = 5356; futura nominal: 5200 → saldo 10556
    expect(a.saldoAberto).toBe(10556);
    expect(a.encargosAcordo).toBe(3000);
    // Rateio 70/30/30 de 10556 → 5684,6/2435,7/2435,7 (maior-resto fecha em 10556)
    const somaFatias = a.porProduto.reduce((s, p) => s + p.saldo, 0);
    expect(somaFatias).toBe(10556);
    expect(r.parteVeiculo.deAcordos).toBe(a.porProduto.find((p) => p.produto === 'veiculo')!.saldo);
    expect(r.parteVeiculo.deAcordos + r.demaisProdutos.total).toBe(10556);
  });

  it('acordo sobre acordo: a referência resolve pela composição do pai', () => {
    const r = decomporSaldoNovacao({
      componentes: [],
      acordos: [
        {
          acordoId: 'A',
          composicao: [
            { produto: 'veiculo', valorNominal: 6000 },
            { produto: 'reembolso', valorNominal: 2000 },
          ],
          valorItens: 10000, // encargos 2000 ÷ 2 → dívidas 7000 veículo / 3000 reembolso
          parcelasAbertas: [], // plano todo coberto pelo acordo B
        },
        {
          acordoId: 'B',
          // Cobriu 5000 de parcelas do acordo A (70/30 → 3500 veic / 1500 reemb)
          // + 1000 de seguro vencido.
          composicao: [
            { ref: 'A', valorNominal: 5000 },
            { produto: 'seguro', valorNominal: 1000 },
          ],
          valorItens: 9000, // encargos 3000 ÷ 3 produtos = 1000 cada
          parcelasAbertas: [{ origem: 'B 1/4', situacao: 'futuro', dias: 10, valorNominal: 9000 }],
        },
      ],
    });
    const b = r.memoria.acordos.find((a) => a.acordoId === 'B')!;
    // Dívidas do B: veículo 3500+1000=4500, reembolso 1500+1000=2500, seguro 1000+1000=2000 (Σ 9000)
    expect(b.porProduto).toEqual([
      { produto: 'veiculo', dividaOriginal: 4500, saldo: 4500 },
      { produto: 'reembolso', dividaOriginal: 2500, saldo: 2500 },
      { produto: 'seguro', dividaOriginal: 2000, saldo: 2000 },
    ]);
    expect(r.parteVeiculo.deAcordos).toBe(4500);
    expect(r.demaisProdutos.total).toBe(4500);
  });

  it('acordo com referência ausente é erro explícito, nunca silêncio', () => {
    expect(() =>
      decomporSaldoNovacao({
        componentes: [],
        acordos: [
          { acordoId: 'B', composicao: [{ ref: 'X', valorNominal: 100 }], valorItens: 100, parcelasAbertas: [] },
        ],
      }),
    ).toThrow(/acordo referenciado/);
  });
});
