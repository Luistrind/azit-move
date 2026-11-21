import { describe, it, expect } from 'vitest';
import { calcularAcertoRescisao, PERCENTUAL_CREDITO_RESCISAO, reaplicarCustosNoAcerto } from './rescisao';

// Doc 02 §29 (decisões Luís 04/11): base = principal (entrada + parcelas), os
// 20% quitam só as vencidas até a data-base, resto a devolver ou remanescente.
const taxas = { taxaMultaPercent: 2, taxaJurosMensalPercent: 1 };

describe('calcularAcertoRescisao', () => {
  it('base dos 20% é só o principal: entrada + parcelas sem proteção e sem encargos', () => {
    const a = calcularAcertoRescisao({
      dataBase: '2026-11-04',
      entradaPaga: 500_000,
      parcelasPagas: [
        { display: '1/100', valorNominal: 99_700, valorPago: 99_700, valorEncargo: null, protecao: 5_000 },
        { display: '2/100', valorNominal: 99_700, valorPago: 101_727, valorEncargo: 2_027, protecao: 5_000 },
        { display: '3/100', valorNominal: 99_700, valorPago: null, valorEncargo: null, protecao: 5_000 }, // legado sem valorPago
      ],
      parcelasAbertas: [],
      ...taxas,
    });
    expect(PERCENTUAL_CREDITO_RESCISAO).toBe(20);
    expect(a.principalParcelas).toBe(3 * 94_700);
    expect(a.principalPago).toBe(500_000 + 284_100);
    expect(a.valorCredito).toBe(Math.round(784_100 * 0.2));
    expect(a.valorADevolver).toBe(a.valorCredito);
    expect(a.saldoRemanescente).toBe(0);
  });

  it('os 20% quitam as vencidas até a data-base (com encargo na data-base); futuras não entram', () => {
    const a = calcularAcertoRescisao({
      dataBase: '2026-11-04',
      entradaPaga: 0,
      parcelasPagas: [{ display: '1/10', valorNominal: 100_000, valorPago: 100_000, valorEncargo: 0, protecao: 0 }],
      parcelasAbertas: [
        { id: 'v1', display: '2/10', valorNominal: 100_000, dataVencimento: '2026-10-05' }, // 30 dias
        { id: 'v2', display: '3/10', valorNominal: 100_000, dataVencimento: '2026-11-04' }, // vence na data-base: 0 dias, sem encargo
        { id: 'f1', display: '4/10', valorNominal: 100_000, dataVencimento: '2026-11-11' }, // futura
      ],
      ...taxas,
    });
    expect(a.valorCredito).toBe(20_000);
    expect(a.vencidas.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(a.vencidas[0].encargo).toBe(Math.round(100_000 * 0.02 + 100_000 * (0.01 / 30) * 30)); // 3.000
    expect(a.vencidas[1].encargo).toBe(0);
    expect(a.dividaVencida).toBe(200_000);
    expect(a.encargosVencidos).toBe(3_000);
    expect(a.dividaTotal).toBe(203_000);
    expect(a.valorCompensado).toBe(20_000);
    expect(a.valorADevolver).toBe(0);
    expect(a.saldoRemanescente).toBe(183_000);
    expect(a.futuras).toEqual({ quantidade: 1, valorNominal: 100_000 });
  });

  it('crédito maior que a dívida: compensa tudo e sobra a devolver', () => {
    const a = calcularAcertoRescisao({
      dataBase: '2026-11-04',
      entradaPaga: 1_000_000,
      parcelasPagas: [],
      parcelasAbertas: [{ id: 'v1', display: '2/10', valorNominal: 50_000, dataVencimento: '2026-11-03' }],
      ...taxas,
    });
    const encargo = Math.round(50_000 * 0.02 + 50_000 * (0.01 / 30) * 1);
    expect(a.valorCredito).toBe(200_000);
    expect(a.valorCompensado).toBe(50_000 + encargo);
    expect(a.valorADevolver).toBe(200_000 - 50_000 - encargo);
    expect(a.saldoRemanescente).toBe(0);
  });
});

describe('rescisão com fatura AZIT paga em parte (doc 02 §32.4-A)', () => {
  // Caso do Vicente: parcela de nominal 749,00 (veículo 699 + proteção 50) numa fatura de 1.049 vencida em
  // 02/11; R$ 540 pagos em 07/11 quitaram multa, atualização, proteção, acessórios e 167,27 do veículo.
  const base = { dataBase: '2026-11-09', entradaPaga: 0, parcelasPagas: [], ...taxas };

  it('ANTES (sem o saldo do motor): cobra nominal cheio + mora desde o vencimento = 765,73 — em dobro', () => {
    const a = calcularAcertoRescisao({ ...base, parcelasAbertas: [{ id: 'pv', display: '22/104', valorNominal: 74_900, dataVencimento: '2026-11-02' }] });
    expect(a.dividaTotal).toBe(76_573);
  });

  it('DEPOIS: a dívida é o saldo do motor (531,73 + 0,35 = 532,08)', () => {
    const a = calcularAcertoRescisao({
      ...base,
      parcelasAbertas: [{ id: 'pv', display: '22/104', valorNominal: 74_900, dataVencimento: '2026-11-02', saldoNominal: 53_173, encargoCalculado: 35 }],
    });
    expect(a.vencidas).toEqual([{ id: 'pv', display: '22/104', dataVencimento: '2026-11-02', diasAtraso: 7, valorNominal: 53_173, encargo: 35, total: 53_208 }]);
    expect(a.dividaVencida).toBe(53_173);
    expect(a.encargosVencidos).toBe(35);
    expect(a.dividaTotal).toBe(53_208);
  });

  it('a base dos 20% conta o principal já pago da parcela ainda em aberto (167,27), sem proteção nem encargo', () => {
    const a = calcularAcertoRescisao({
      ...base,
      entradaPaga: 500_000,
      principalParcial: 16_727,
      parcelasAbertas: [{ id: 'pv', display: '22/104', valorNominal: 74_900, dataVencimento: '2026-11-02', saldoNominal: 53_173, encargoCalculado: 35 }],
    });
    expect(a.principalParcial).toBe(16_727);
    expect(a.principalPago).toBe(516_727);
    expect(a.valorCredito).toBe(Math.round(516_727 * 0.2));
    expect(a.parcelasPagas).toBe(0); // a parcela não virou "paga" — só o principal dela entrou na base
  });

  it('parcela futura paga em parte: o que fica de fora é só o saldo', () => {
    const a = calcularAcertoRescisao({ ...base, parcelasAbertas: [{ id: 'p', display: '23/104', valorNominal: 74_900, dataVencimento: '2026-11-16', saldoNominal: 34_900 }] });
    expect(a.futuras).toEqual({ quantidade: 1, valorNominal: 34_900 });
    expect(a.dividaTotal).toBe(0);
  });
});

describe('custos da recuperação e multas no acerto (doc 02 §29.3, 20/11)', () => {
  // Protótipo: entrada 1.990 + 26 parcelas de principal 942 → base 26.482 → crédito 5.296,40.
  const pagas = Array.from({ length: 26 }, (_, i) => ({ display: `${i + 1}/156`, valorNominal: 99_200, valorPago: 99_200, valorEncargo: 0, protecao: 5_000 }));
  const base = { dataBase: '2026-11-16', entradaPaga: 199_000, parcelasPagas: pagas, ...taxas };
  const custos = [
    { id: 'c1', tipo: 'retomada', descricao: 'Retirada', valor: 80_000, orcado: false },
    { id: 'c2', tipo: 'avaria', descricao: 'Para-choque', valor: 165_000, orcado: true },
  ];
  const multas = [{ id: 'm1', descricao: 'Multa AB123', valor: 29_347 }];

  it('os 20% abatem a dívida TODA: parcelas + encargo + custos (orçados e pagos) + multas', () => {
    const a = calcularAcertoRescisao({
      ...base,
      parcelasAbertas: [{ id: 'p', display: '27/156', valorNominal: 99_200, dataVencimento: '2026-11-16' }],
      custos,
      multas,
    });
    expect(a.valorCredito).toBe(529_640);
    expect(a.custosCliente).toBe(245_000);
    expect(a.custosOrcados).toBe(165_000);
    expect(a.multasVeiculo).toBe(29_347);
    expect(a.dividaTotal).toBe(a.dividaVencida + a.encargosVencidos + 245_000 + 29_347);
    expect(a.valorCompensado).toBe(a.dividaTotal); // crédito cobre tudo
    expect(a.valorADevolver).toBe(529_640 - a.dividaTotal);
    expect(a.saldoRemanescente).toBe(0);
  });

  it('nunca "a devolver" e "saldo" ao mesmo tempo: custos acima do crédito viram saldo remanescente', () => {
    const a = calcularAcertoRescisao({ ...base, parcelasAbertas: [], custos: [...custos, { id: 'c3', tipo: 'outro', descricao: 'Motor', valor: 400_000, orcado: true }], multas });
    expect(a.dividaTotal).toBe(674_347);
    expect(a.valorADevolver).toBe(0);
    expect(a.saldoRemanescente).toBe(674_347 - 529_640);
  });

  it('devolução de boa-fé sem parcela vencida: a dívida é só o custo do reparo', () => {
    const a = calcularAcertoRescisao({ ...base, parcelasAbertas: [{ id: 'f', display: '27/156', valorNominal: 99_200, dataVencimento: '2026-11-23' }], custos: [custos[1]] });
    expect(a.vencidas).toEqual([]);
    expect(a.futuras.quantidade).toBe(1);
    expect(a.dividaTotal).toBe(165_000);
    expect(a.valorADevolver).toBe(529_640 - 165_000);
  });

  it('corte na data-base: parcela que venceu DEPOIS da retomada não entra, mesmo se a rescisão for lançada dias depois', () => {
    const a = calcularAcertoRescisao({
      ...base,
      parcelasAbertas: [
        { id: 'v', display: '27/156', valorNominal: 99_200, dataVencimento: '2026-11-16' },
        { id: 'd', display: '28/156', valorNominal: 99_200, dataVencimento: '2026-11-23' }, // já vencida "hoje", mas depois da retomada
      ],
    });
    expect(a.vencidas.map((v) => v.id)).toEqual(['v']);
    expect(a.futuras).toEqual({ quantidade: 1, valorNominal: 99_200 });
  });

  it('sem custos nem multas o resultado é o de antes (campos novos zerados)', () => {
    const a = calcularAcertoRescisao({ ...base, parcelasAbertas: [{ id: 'p', display: '27/156', valorNominal: 99_200, dataVencimento: '2026-11-09' }] });
    expect(a.custos).toEqual([]);
    expect(a.custosCliente).toBe(0);
    expect(a.multasVeiculo).toBe(0);
    expect(a.dividaTotal).toBe(a.dividaVencida + a.encargosVencidos);
  });
});

describe('reaplicarCustosNoAcerto — ajuste depois da rescisão (doc 02 §29.3)', () => {
  const pagas = Array.from({ length: 10 }, (_, i) => ({ display: `${i + 1}/100`, valorNominal: 99_200, valorPago: 99_200, valorEncargo: 0, protecao: 5_000 }));
  const original = calcularAcertoRescisao({
    dataBase: '2026-11-16', entradaPaga: 199_000, parcelasPagas: pagas, ...taxas,
    parcelasAbertas: [{ id: 'p', display: '11/100', valorNominal: 99_200, dataVencimento: '2026-11-09' }],
    custos: [{ id: 'c1', tipo: 'avaria', descricao: 'Funilaria', valor: 165_000, orcado: true }],
    multas: [{ id: 'm1', descricao: 'Multa', valor: 29_347 }],
  });

  it('mesma lista de custos → mesmo acerto', () => {
    expect(reaplicarCustosNoAcerto(original, original.custos ?? [])).toEqual(original);
  });

  it('orçamento virou nota menor e apareceu custo novo: só a parte dos custos muda', () => {
    const novo = reaplicarCustosNoAcerto(original, [
      { id: 'c1', tipo: 'avaria', descricao: 'Funilaria', valor: 158_000, orcado: false },
      { id: 'c2', tipo: 'outro', descricao: 'Banco rasgado', valor: 62_000, orcado: true },
    ]);
    expect(novo.valorCredito).toBe(original.valorCredito);
    expect(novo.vencidas).toEqual(original.vencidas);
    expect(novo.multasVeiculo).toBe(29_347);
    expect(novo.custosCliente).toBe(220_000);
    expect(novo.custosOrcados).toBe(62_000);
    expect(novo.dividaTotal).toBe(original.dividaTotal - 165_000 + 220_000);
    expect(novo.saldoRemanescente - novo.valorADevolver).toBe(novo.dividaTotal - novo.valorCredito);
  });

  it('acerto antigo (gravado antes de 20/11, sem custos nem multas) aceita o primeiro custo', () => {
    const { custos: _c, custosCliente: _cc, custosOrcados: _co, multas: _m, multasVeiculo: _mv, ...antigo } = calcularAcertoRescisao({
      dataBase: '2026-11-04', entradaPaga: 100_000, parcelasPagas: [], ...taxas,
      parcelasAbertas: [{ id: 'p', display: '1/10', valorNominal: 50_000, dataVencimento: '2026-11-04' }],
    });
    const novo = reaplicarCustosNoAcerto(antigo, [{ id: 'c', tipo: 'guincho', descricao: 'Guincho', valor: 35_000, orcado: false }]);
    expect(novo.dividaTotal).toBe(antigo.dividaTotal + 35_000);
    expect(novo.saldoRemanescente).toBe(antigo.dividaTotal + 35_000 - 20_000);
  });
});
