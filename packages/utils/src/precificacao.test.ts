import { describe, it, expect } from 'vitest';
import { precificarPrice, TAXA_SEMANAL_PROVISORIA } from './precificacao';

describe('precificarPrice (PROVISÓRIA — Vicente)', () => {
  it('taxa zero: parcela = financiado / n', () => {
    const r = precificarPrice({ valorVenda: 1200000, valorEntrada: 0, prazoSemanas: 12, taxaSemanal: 0 });
    expect(r.valorFinanciado).toBe(1200000);
    expect(r.valorParcela).toBe(100000);
    expect(r.totalParcelado).toBe(1200000);
  });

  it('desconta a entrada do valor de venda', () => {
    const r = precificarPrice({ valorVenda: 5000000, valorEntrada: 1000000, prazoSemanas: 10, taxaSemanal: 0 });
    expect(r.valorFinanciado).toBe(4000000);
    expect(r.valorParcela).toBe(400000);
    expect(r.totalAPagar).toBe(1000000 + 4000000);
  });

  it('Price com juros (taxa explícita): parcela > financiado/n e total > financiado', () => {
    const r = precificarPrice({ valorVenda: 1000000, valorEntrada: 0, prazoSemanas: 10, taxaSemanal: 0.005 });
    expect(r.taxaSemanal).toBe(0.005);
    expect(r.valorParcela).toBeGreaterThan(100000); // juros encarecem
    expect(r.totalParcelado).toBeGreaterThan(1000000);
    expect(r.provisorio).toBe(true);
  });

  it('taxa provisória atualmente ZERADA: parcela = financiado / n (sem juros)', () => {
    expect(TAXA_SEMANAL_PROVISORIA).toBe(0);
    const r = precificarPrice({ valorVenda: 1000000, valorEntrada: 0, prazoSemanas: 10 });
    expect(r.taxaSemanal).toBe(0);
    expect(r.valorParcela).toBe(100000);
    expect(r.totalParcelado).toBe(1000000);
  });

  it('valida prazo inteiro >= 1', () => {
    expect(() => precificarPrice({ valorVenda: 100, valorEntrada: 0, prazoSemanas: 0 })).toThrow();
  });
});

// ============================================================
// Simulação V3 — caso de verificação da planilha do Vicente (HB20S):
// VA 50.000, EN 6.500, 30 meses, CI 3.990, CR 599, TR 2% a.m. → PMT R$ 2.719,42
// ============================================================
import { precificarSimulacao, precificarCreditoAvulso, precificarReembolsoParcelado, anteciparParcelaComponentes, contribuicaoProtecaoVeicular } from './precificacao';

const BASE = {
  valorAvista: 5_000_000,
  valorEntrada: 650_000,
  prazoMeses: 30,
  comissaoInicial: 399_000,
  comissaoRecorrente: 59_900,
  taxaMensal: 0.02,
  fatorPrecificacaoSemanal: 4,
  fatorPrecificacaoQuinzenal: 2,
  fatorSemanal: 4.345,
  fatorQuinzenal: 2.1725,
} as const;

describe('precificarSimulacao (V3 — planilha Vicente)', () => {
  it('reproduz o caso HB20S da planilha (mensal)', () => {
    const r = precificarSimulacao({ ...BASE, frequencia: 'mensal' });
    expect(r.valorParcelamento).toBe(4_749_000); // VP = VA + CI - EN
    expect(r.parcelaMensalBase).toBe(212_042); // PM1
    expect(r.parcelaMensalTotal).toBe(271_942); // PMT = R$ 2.719,42
    expect(r.parcelaFinal).toBe(271_942);
    expect(r.numeroParcelas).toBe(30);
  });

  it('reunião 11/07: PARCELA divide por 4/2 (precificação); Nº DE PARCELAS usa 4,345 (contrato)', () => {
    const semanal = precificarSimulacao({ ...BASE, frequencia: 'semanal' });
    expect(semanal.parcelaFinal).toBe(67_986); // PMT/4 = R$ 679,86 (memória validada na reunião)
    expect(semanal.numeroParcelas).toBe(Math.round(30 * 4.345)); // 130 parcelas
    const quinzenal = precificarSimulacao({ ...BASE, frequencia: 'quinzenal' });
    expect(quinzenal.parcelaFinal).toBe(135_971); // PMT/2 = R$ 1.359,71
    expect(quinzenal.numeroParcelas).toBe(Math.round(30 * 2.1725)); // 65 parcelas
  });

  it('taxa zero: PM1 = VP / PC', () => {
    const r = precificarSimulacao({ ...BASE, taxaMensal: 0, frequencia: 'mensal' });
    expect(r.parcelaMensalBase).toBe(Math.round(4_749_000 / 30));
  });
});

describe('precificarCreditoAvulso', () => {
  it('taxa zero: parcela = financiado / n', () => {
    const r = precificarCreditoAvulso({ valorFinanciado: 300_000, numeroParcelas: 3, taxaMensal: 0, fator: 1 });
    expect(r.valorParcela).toBe(100_000);
  });
  it('com TR 2% a.m. mensal, parcela > financiado/n', () => {
    const r = precificarCreditoAvulso({ valorFinanciado: 300_000, numeroParcelas: 3, taxaMensal: 0.02, fator: 1 });
    expect(r.valorParcela).toBeGreaterThan(100_000);
  });
});

import { anteciparParcela } from './precificacao';

describe('anteciparParcela (planilha Vicente 11/07)', () => {
  it('reproduz a linha da planilha (3 dias): CR 147,2801 + PS 790,0839', () => {
    const r = anteciparParcela({
      valorNominal: 94_200,
      componenteCR: 14_999,
      dias: 3,
      taxaDescontoCR: 0.2,
      taxaDescontoPS: 0.0246482,
    });
    expect(r.crHoje).toBe(14_728); // R$ 147,28
    expect(r.psHoje).toBe(79_008); // R$ 790,08
    expect(r.valorPresente).toBe(93_736); // R$ 937,36
  });
  it('vencida/hoje: sem desconto', () => {
    const r = anteciparParcela({ valorNominal: 94_200, componenteCR: 14_999, dias: 0, taxaDescontoCR: 0.2, taxaDescontoPS: 0.02 });
    expect(r.valorPresente).toBe(94_200);
  });
});

describe('precificarReembolsoParcelado (Catálogo F3 — planilha do Vicente)', () => {
  const params = {
    encargoMensal: 0.1999,
    taxaInicialPct: 0.0999,
    taxaInicialMinima: 9990,
  };

  it('caso de ouro personalizada: R$ 3.000 em 26 semanas → R$ 214,26', () => {
    const r = precificarReembolsoParcelado({
      valorReembolso: 300000,
      numeroParcelas: 26,
      frequencia: 'semanal',
      ...params,
    });
    expect(r.taxaInicial).toBe(29970); // 9,99% de 3.000 (acima da mínima 99,90)
    expect(r.valorFinanciado).toBe(329970);
    expect(r.valorParcela).toBe(21426);
  });

  it('oferta padrão 1: R$ 3.000 em 12 semanas → R$ 358,64', () => {
    const r = precificarReembolsoParcelado({
      valorReembolso: 300000,
      numeroParcelas: 12,
      frequencia: 'semanal',
      ...params,
    });
    expect(r.valorParcela).toBe(35864);
  });

  it('taxa mínima de processamento vale para valores pequenos', () => {
    const r = precificarReembolsoParcelado({
      valorReembolso: 50000, // R$ 500 → 9,99% = 49,95 < mínima 99,90
      numeroParcelas: 4,
      frequencia: 'semanal',
      ...params,
    });
    expect(r.taxaInicial).toBe(9990);
  });
});

describe('anteciparParcelaComponentes (Catálogo F4)', () => {
  // Parcela do caso de ouro da Compra Parcelada: 743,24 = bem 485,78 + comissão 199,99 + proteção 57,47
  const parcela = {
    valorNominal: 74324,
    componenteComissao: 19999,
    componenteProtecao: 5747,
    taxaDescontoBem: 0.016, // TRD Carro
    taxaDescontoComissao: 0, // sem desconto — cobra cheia
    taxaDescontoProtecao: 0,
  };

  it('parcial 30 dias antes: bem descontado por 1,6%, comissão e proteção CHEIAS', () => {
    const r = anteciparParcelaComponentes({ ...parcela, dias: 30, isentarComissao: false, isentarProtecao: false });
    expect(r.bemNominal).toBe(48578);
    expect(r.bemPresente).toBe(Math.round(48578 / 1.016)); // 47813
    expect(r.comissaoCobrada).toBe(19999);
    expect(r.protecaoCobrada).toBe(5747);
    expect(r.valorPresente).toBe(r.bemPresente + 19999 + 5747);
  });

  it('liquidação total: comissão e proteção futuras ISENTAS — paga só o bem descontado', () => {
    const r = anteciparParcelaComponentes({ ...parcela, dias: 30, isentarComissao: true, isentarProtecao: true });
    expect(r.comissaoCobrada).toBe(0);
    expect(r.protecaoCobrada).toBe(0);
    expect(r.valorPresente).toBe(r.bemPresente);
  });

  it('parcela vencendo hoje: sem desconto em nada', () => {
    const r = anteciparParcelaComponentes({ ...parcela, dias: 0, isentarComissao: false, isentarProtecao: false });
    expect(r.valorPresente).toBe(74324);
  });
});

describe('contribuicaoProtecaoVeicular (Catálogo F5 — planilha do Vicente)', () => {
  it('caso de ouro: Leves, FIPE 50.000, oferta Essencial → R$ 229,86/mês e R$ 57,47/semana', () => {
    const r = contribuicaoProtecaoVeicular({
      fipe: 5000000,
      contribuicaoMinimaMensal: 19996,
      taxaFipeMensal: 0.0035,
      taxaAdministracaoMensal: 2990,
      custoAssistenciaMensal: 0,
      acrescimoPerfilMensal: 0,
      frequencia: 'semanal',
    });
    expect(r.baseFipe).toBe(17500); // abaixo da mínima 199,96 → vale a mínima
    expect(r.contribuicaoMensal).toBe(22986);
    expect(r.contribuicaoPeriodo).toBe(5747); // 57,47 por semana (planilha A13)
  });

  it('FIPE alta: a taxa sobre a FIPE supera a mínima', () => {
    const r = contribuicaoProtecaoVeicular({
      fipe: 10000000, // R$ 100.000 × 0,5% = 500 > mínima
      contribuicaoMinimaMensal: 19996,
      taxaFipeMensal: 0.005,
      taxaAdministracaoMensal: 2990,
      custoAssistenciaMensal: 1990,
      acrescimoPerfilMensal: 0,
      frequencia: 'mensal',
    });
    expect(r.contribuicaoMensal).toBe(50000 + 2990 + 1990);
  });
});
