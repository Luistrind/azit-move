import { describe, it, expect } from 'vitest';
import {
  decomporSaldoNovacao,
  precificarNovacao,
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

  it('comissão embutida sai do FUTURO (A4.1) e fica auditada; vencido permanece cheio', () => {
    const r = decomporSaldoNovacao({
      componentes: [
        // Vencido: nominal cheio (com CR) + mora — dívida consumada.
        { origem: 'Parcela 1/10', produto: 'veiculo', situacao: 'vencido', dias: 30, valorNominal: 10000, comissaoEmbutida: 2000 },
        // Futuro: CR de 2.000 sai ANTES do VP → 8000/(1.016) = 7874.
        { origem: 'Parcela 2/10', produto: 'veiculo', situacao: 'futuro', dias: 30, valorNominal: 10000, comissaoEmbutida: 2000, taxaVpMensal: 0.016 },
      ],
      acordos: [],
    });
    expect(r.parteVeiculo.vencido).toBe(10300); // 10000 + 2% + 1%
    expect(r.parteVeiculo.futuro).toBe(7874);
    const cr = r.memoria.ignorados.find((i) => i.motivo.includes('A4.1'));
    expect(cr?.valorNominal).toBe(2000);
    expect(cr?.origem).toContain('Parcela 2/10');
    expect(r.memoria.ignorados).toHaveLength(1); // só o futuro — o vencido não audita
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

describe('precificarNovacao (A7 passos 3-4)', () => {
  // Overrides zerados isolam a aritmética; os defaults reais (1,70%, TP
  // max(2%; 3.990)) são testados em separado.
  const semTaxas = { taxaMensal: 0, taxaInicialPct: 0, taxaInicialMinima: 0 };

  it('sem juros e sem demais produtos: divisão simples com ajuste na última', () => {
    const r = precificarNovacao({
      saldoVeiculo: 120000, saldoDemais: 0, numeroParcelasVeiculo: 12, frequencia: 'semanal', ...semTaxas,
    });
    expect(r.valorParcela).toBe(10000);
    expect(r.contrato2.totalParcelas).toBe(0);
    expect(r.contrato1.totalParcelas).toBe(12);
    expect(r.contrato1.valorUltima).toBe(10000);
    expect(r.totalAPagar).toBe(120000);
  });

  it('taxa inicial de processamento: max(2% do saldo-base; R$ 3.990), financiada sem recebimento', () => {
    const r = precificarNovacao({
      saldoVeiculo: 1000000, saldoDemais: 0, numeroParcelasVeiculo: 24, frequencia: 'mensal', taxaMensal: 0,
    });
    // 2% de 10.000,00 = 200,00 < 3.990,00 → mínima vale; sem recebimento, financiada inteira.
    expect(r.taxaInicial).toBe(399000);
    expect(r.tpFinanciada).toBe(399000);
    expect(r.saldoAParcelarVeiculo).toBe(1399000);
  });

  it('taxa inicial percentual vence a mínima em saldos altos', () => {
    const r = precificarNovacao({
      saldoVeiculo: 30000000, saldoDemais: 0, numeroParcelasVeiculo: 48, frequencia: 'mensal', taxaMensal: 0,
    });
    expect(r.taxaInicial).toBe(600000); // 2% de 300.000,00
  });

  it('recebimento inicial: taxa apropriada primeiro, sobra amortiza; mínimo = max(1% SN; TP)', () => {
    const r = precificarNovacao({
      saldoVeiculo: 1000000, saldoDemais: 0, numeroParcelasVeiculo: 24, frequencia: 'mensal',
      taxaMensal: 0, recebimentoInicial: 500000,
    });
    expect(r.entradaMinima).toBe(399000); // max(1%×10.000 = 100,00; TP 3.990,00)
    expect(r.tpFinanciada).toBe(0);
    expect(r.amortizacaoInicial).toBe(101000);
    expect(r.saldoAParcelarVeiculo).toBe(899000);
    expect(r.excecoes).toHaveLength(0);
  });

  it('recebimento abaixo do mínimo operacional vira exceção, não bloqueio', () => {
    const r = precificarNovacao({
      saldoVeiculo: 1000000, saldoDemais: 0, numeroParcelasVeiculo: 24, frequencia: 'mensal',
      taxaMensal: 0, recebimentoInicial: 100000,
    });
    expect(r.excecoes.some((e) => e.includes('mínimo operacional'))).toBe(true);
  });

  it('desconto reduz o saldo novado e marca a exceção do comitê', () => {
    const r = precificarNovacao({
      saldoVeiculo: 1000000, saldoDemais: 0, desconto: 100000, numeroParcelasVeiculo: 24,
      frequencia: 'mensal', ...semTaxas,
    });
    expect(r.saldoBase).toBe(1000000); // TP incide sobre o saldo-base, não o novado
    expect(r.saldoNovado).toBe(900000);
    expect(r.excecoes.some((e) => e.includes('comitê'))).toBe(true);
  });

  it('Contrato 2 primeiro: mesma parcela, fatura de transição com antecipação do veículo', () => {
    const r = precificarNovacao({
      saldoVeiculo: 120000, saldoDemais: 25000, numeroParcelasVeiculo: 12, frequencia: 'semanal', ...semTaxas,
    });
    expect(r.valorParcela).toBe(10000);
    // C2 25000 a 100,00: 2 cheias + última 50,00; transição completa com 50,00 do veículo.
    expect(r.contrato2.parcelasCheias).toBe(2);
    expect(r.contrato2.valorUltima).toBe(5000);
    expect(r.contrato2.antecipacaoTransicao).toBe(5000);
    // Veículo: 120000 − 5000 antecipados = 115000 → 11 cheias + última 50,00.
    expect(r.contrato1.saldo).toBe(115000);
    expect(r.contrato1.totalParcelas).toBe(12);
    expect(r.contrato1.valorUltima).toBe(5000);
    // Cliente paga o mesmo valor periódico em TODAS as faturas menos a última.
    expect(r.totalAPagar).toBe(25000 + 5000 + 115000);
    expect(r.totalParcelasRelacionamento).toBe(15);
  });

  it('parcela composta (F4): CR e proteção somam por cima; Termo amortiza com a CR (A4.3)', () => {
    const r = precificarNovacao({
      saldoVeiculo: 120000, saldoDemais: 25000, numeroParcelasVeiculo: 12, frequencia: 'semanal',
      comissaoPorPeriodo: 2000, protecaoPorPeriodo: 800, ...semTaxas,
    });
    expect(r.valorParcela).toBe(10000);
    expect(r.valorParcelaTotal).toBe(12800); // 100,00 + 20,00 + 8,00
    // Termo amortizado a (financeira + CR) = 120,00: 25000 → 2 cheias + resto 10,00.
    expect(r.contrato2.parcelasCheias).toBe(2);
    expect(r.contrato2.valorUltima).toBe(1000);
    expect(r.contrato2.antecipacaoTransicao).toBe(11000); // completa até 120,00
    // Termo composto: 2×(120+8) + (10+8) = 274,00.
    expect(r.contrato2.totalComposto).toBe(2 * 12800 + 1800);
    // Veículo: 120000 − 11000 antecipados = 109000 → 10 cheias + última 90,00.
    expect(r.contrato1.saldo).toBe(109000);
    expect(r.contrato1.parcelasCheias).toBe(10);
    expect(r.contrato1.valorUltima).toBe(9000);
    // Veículo composto: 10×128,00 + (90+20+8) = 1.397,80.
    expect(r.contrato1.totalComposto).toBe(10 * 12800 + 11800);
    // Total = termo composto + antecipação + veículo composto.
    expect(r.totalAPagar).toBe(r.contrato2.totalComposto + 11000 + r.contrato1.totalComposto);
    // Fatura de transição fecha na parcela única: resto + antecipação + proteção.
    expect(1000 + 11000 + 800).toBe(r.valorParcelaTotal);
  });

  it('sem CR e sem proteção: comportamento anterior intacto (defaults 0)', () => {
    const r = precificarNovacao({
      saldoVeiculo: 120000, saldoDemais: 25000, numeroParcelasVeiculo: 12, frequencia: 'semanal', ...semTaxas,
    });
    expect(r.valorParcelaTotal).toBe(r.valorParcela);
    expect(r.contrato2.totalComposto).toBe(25000);
    expect(r.contrato1.totalComposto).toBe(115000);
    expect(r.totalAPagar).toBe(145000);
  });

  it('com a taxa real de 1,70% a.m.: Price fecha (n1 parcelas, última ~ parcela padrão)', () => {
    const r = precificarNovacao({
      saldoVeiculo: 1200000, saldoDemais: 0, numeroParcelasVeiculo: 12, frequencia: 'mensal',
      taxaInicialPct: 0, taxaInicialMinima: 0,
    });
    // PMT Price(12.000; 1,7%; 12) ≈ 1.113,79 — a amortização a parcela fixa
    // deve devolver exatamente 12 parcelas com última ≈ PMT (deriva de centavos).
    expect(r.taxaPeriodo).toBeCloseTo(0.017, 10);
    expect(r.contrato1.totalParcelas).toBe(12);
    expect(Math.abs(r.contrato1.valorUltima - r.valorParcela)).toBeLessThan(50);
  });

  it('equivalência por frequência: taxa semanal = (1,017)^(7/30) − 1', () => {
    const r = precificarNovacao({
      saldoVeiculo: 100000, saldoDemais: 0, numeroParcelasVeiculo: 4, frequencia: 'semanal',
      taxaInicialPct: 0, taxaInicialMinima: 0,
    });
    expect(r.taxaPeriodo).toBeCloseTo(Math.pow(1.017, 7 / 30) - 1, 12);
  });

  it('prazo total acima de 60 meses vira exceção', () => {
    const r = precificarNovacao({
      saldoVeiculo: 100000, saldoDemais: 0, numeroParcelasVeiculo: 280, frequencia: 'semanal', ...semTaxas,
    });
    expect(r.excecoes.some((e) => e.includes('60 meses'))).toBe(true);
  });

  it('parcela que não amortiza o Contrato 2 é erro explícito', () => {
    expect(() =>
      precificarNovacao({
        // parcela do veículo minúscula × saldo demais alto a 1,7% → juros > parcela
        saldoVeiculo: 10000, saldoDemais: 10000000, numeroParcelasVeiculo: 1, frequencia: 'mensal',
        taxaInicialPct: 0, taxaInicialMinima: 0,
      }),
    ).toThrow(/não amortiza/);
  });
});

describe('conversão de prazo (fator padrão 4,3452/2,1726 — correção 14/09)', () => {
  it('60 meses = 261 parcelas semanais; 260 NÃO excede o teto', () => {
    const r = precificarNovacao({
      saldoVeiculo: 10000000, saldoDemais: 0, numeroParcelasVeiculo: 260, frequencia: 'semanal',
      taxaInicialPct: 0, taxaInicialMinima: 0,
    });
    // Caso real (14/09): 260 semanais = 60 meses pelo fator da casa — a conta
    // por dias corridos (60×30/7 = 257) marcava exceção indevida.
    expect(r.excecoes).toHaveLength(0);
    expect(r.contrato1.totalParcelas).toBe(260);
  });

  it('262 parcelas semanais excede 60 meses', () => {
    const r = precificarNovacao({
      saldoVeiculo: 10000000, saldoDemais: 0, numeroParcelasVeiculo: 262, frequencia: 'semanal',
      taxaInicialPct: 0, taxaInicialMinima: 0,
    });
    expect(r.excecoes.some((e) => e.includes('60 meses'))).toBe(true);
  });
});
