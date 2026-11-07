import { describe, it, expect } from 'vitest';
import { calcularAcertoRescisao, PERCENTUAL_CREDITO_RESCISAO } from './rescisao';

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
