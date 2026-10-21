import { describe, it, expect } from 'vitest';
import esperado from './__fixtures__/formulas-regressao.json';
import {
  anteciparParcela,
  anteciparParcelaComponentes,
  precificarReembolsoParcelado,
  precificarAcordoPagamento,
  precificarCreditoAvulso,
  precificarSimulacao,
} from './precificacao';
import { decomporSaldoNovacao, precificarNovacao } from './novacao';
import { parcelasPorPrazoMeses, valorPresenteMensal } from './calculations';
import { conciliarLegado } from './legado-conciliacao';

// ============================================================
// REGRESSÃO DA CONSOLIDAÇÃO "uma conta, uma função" (Regra 16, 20/10/2026).
// O fixture foi gerado pelo código ANTES da consolidação (valor presente em
// dois lugares, Price repetida 4×, dias por cópia de DIA_MS/difDias). Depois
// dela, os mesmos insumos têm de produzir EXATAMENTE os mesmos números —
// antecipação/quitação, decomposição e precificação da novação, reembolso,
// acordo, crédito avulso, simulação e conciliação do legado. Mudou um centavo
// aqui = mudou a regra, não a arrumação.
// ============================================================

// Compara só as chaves do fixture (o resultado pode ter campos NOVOS, ex.:
// taxaMensal na novação); números com tolerância de 1e-9 relativa.
function igual(atual: unknown, esperado: unknown, caminho: string): void {
  if (typeof esperado === 'number') {
    expect(typeof atual, caminho).toBe('number');
    const a = atual as number;
    if (Number.isInteger(esperado)) expect(a, caminho).toBe(esperado);
    else expect(Math.abs(a - esperado) <= Math.abs(esperado) * 1e-9 + 1e-9, `${caminho}: ${a} ≠ ${esperado}`).toBe(true);
    return;
  }
  if (Array.isArray(esperado)) {
    expect(Array.isArray(atual), caminho).toBe(true);
    expect((atual as unknown[]).length, caminho).toBe(esperado.length);
    esperado.forEach((e, i) => igual((atual as unknown[])[i], e, `${caminho}[${i}]`));
    return;
  }
  if (esperado && typeof esperado === 'object') {
    expect(atual && typeof atual === 'object', caminho).toBe(true);
    for (const k of Object.keys(esperado)) igual((atual as Record<string, unknown>)[k], (esperado as Record<string, unknown>)[k], `${caminho}.${k}`);
    return;
  }
  expect(atual, caminho).toEqual(esperado);
}

describe('regressão — números iguais aos de antes da consolidação', () => {
  it('valor presente (doc 02 §7.4)', () => {
    const vp = [[99700, 0.02, 7], [99700, 0.2, 45], [250000, 0.017, 360], [1, 0.0499, 1], [94200, 0, 10], [94200, 0.02, 0]].map(([v, t, d]) => valorPresenteMensal(v, t, d));
    igual(vp, esperado.vp, 'vp');
  });

  it('antecipação CR/PS (quitação antecipada — parâmetros)', () => {
    const r = [
      anteciparParcela({ valorNominal: 94_200, componenteCR: 14_999, dias: 7, taxaDescontoCR: 0.2, taxaDescontoPS: 0.02 }),
      anteciparParcela({ valorNominal: 94_200, componenteCR: 14_999, dias: 91, taxaDescontoCR: 0.2, taxaDescontoPS: 0.02 }),
      anteciparParcela({ valorNominal: 67_986, componenteCR: 0, dias: 364, taxaDescontoCR: 0, taxaDescontoPS: 0.033 }),
    ];
    igual(r, esperado.antecipar, 'antecipar');
  });

  it('antecipação por componente (quitação antecipada — catálogo F4)', () => {
    const base = { valorNominal: 94_200, componenteComissao: 14_975, componenteProtecao: 6_250, taxaDescontoBem: 0.0199, taxaDescontoComissao: 0.2, taxaDescontoProtecao: 0.1 };
    const r = [
      anteciparParcelaComponentes({ ...base, dias: 30, isentarComissao: false, isentarProtecao: false }),
      anteciparParcelaComponentes({ ...base, dias: 203, isentarComissao: true, isentarProtecao: true }),
      anteciparParcelaComponentes({ ...base, dias: 0, isentarComissao: false, isentarProtecao: false }),
      anteciparParcelaComponentes({ ...base, dias: 14, taxaDescontoComissao: 0, taxaDescontoProtecao: 0, isentarComissao: false, isentarProtecao: false }),
    ];
    igual(r, esperado.componentes, 'componentes');
  });

  it('reembolso parcelado, acordo de pagamento, crédito avulso e simulação V3', () => {
    igual(
      [
        precificarReembolsoParcelado({ valorReembolso: 164_802, numeroParcelas: 6, frequencia: 'semanal', encargoMensal: 0.1999, taxaInicialPct: 0.0999, taxaInicialMinima: 9_990 }),
        precificarReembolsoParcelado({ valorReembolso: 250_000, numeroParcelas: 4, frequencia: 'mensal', encargoMensal: 0.1999, taxaInicialPct: 0.0999, taxaInicialMinima: 9_990 }),
        precificarReembolsoParcelado({ valorReembolso: 50_000, numeroParcelas: 3, frequencia: 'quinzenal', encargoMensal: 0.05, taxaInicialPct: 0.0999, taxaInicialMinima: 9_990 }),
      ],
      esperado.reembolso,
      'reembolso',
    );
    igual(
      [
        precificarAcordoPagamento({ saldoNegociado: 398_800, valorEntrada: 120_000, numeroParcelas: 8, frequencia: 'semanal', encargoMensal: 0.0499, taxaInicialPct: 0.0999, entradaMinimaPct: 0.3 }),
        precificarAcordoPagamento({ saldoNegociado: 398_800, valorEntrada: 10_000, numeroParcelas: 3, frequencia: 'mensal', encargoMensal: 0.0499, taxaInicialPct: 0.0999, entradaMinimaPct: 0.3 }),
      ],
      esperado.acordo,
      'acordo',
    );
    igual(
      [
        precificarCreditoAvulso({ valorFinanciado: 300_000, numeroParcelas: 26, taxaMensal: 0.02, fator: 4.3452 }),
        precificarCreditoAvulso({ valorFinanciado: 300_000, numeroParcelas: 6, taxaMensal: 0.02, fator: 1 }),
        precificarCreditoAvulso({ valorFinanciado: 123_456, numeroParcelas: 13, taxaMensal: 0.0499, fator: 2.1726 }),
      ],
      esperado.creditoAvulso,
      'creditoAvulso',
    );
    igual(
      [
        precificarSimulacao({ valorAvista: 4_500_000, valorEntrada: 150_000, prazoMeses: 30, frequencia: 'semanal', comissaoInicial: 399_000, comissaoRecorrente: 59_900, taxaMensal: 0.02, fatorPrecificacaoSemanal: 4, fatorPrecificacaoQuinzenal: 2, fatorSemanal: 4.3452, fatorQuinzenal: 2.1726 }),
      ],
      esperado.simulacao,
      'simulacao',
    );
  });

  it('decomposição do saldo e precificação da novação', () => {
    const dec = decomporSaldoNovacao({
      componentes: [
        { origem: 'p1', produto: 'veiculo', valorNominal: 99_700, situacao: 'vencido', dias: 12 },
        { origem: 'p2', produto: 'veiculo', valorNominal: 99_700, situacao: 'futuro', dias: 7, taxaVpMensal: 0.02, comissaoEmbutida: 14_975 },
        { origem: 'p3', produto: 'veiculo', valorNominal: 99_700, situacao: 'futuro', dias: 364, taxaVpMensal: 0.02 },
        { origem: 's1', produto: 'seguro', valorNominal: 6_250, situacao: 'vencido', dias: 40 },
        { origem: 'r1', produto: 'reembolso', valorNominal: 30_000, situacao: 'futuro', dias: 21, taxaVpMensal: 0.1999 },
      ],
      acordos: [],
    });
    igual(dec, esperado.decomposicao, 'decomposicao');
    const nov = [
      precificarNovacao({ saldoVeiculo: 1_200_000, saldoDemais: 85_000, numeroParcelasVeiculo: 52, frequencia: 'semanal', taxaMensal: 0.017, recebimentoInicial: 50_000, comissaoPorPeriodo: 14_975, protecaoPorPeriodo: 6_250 }),
      precificarNovacao({ saldoVeiculo: 1_200_000, saldoDemais: 0, numeroParcelasVeiculo: 12, frequencia: 'mensal', taxaInicialPct: 0, taxaInicialMinima: 0 }),
      precificarNovacao({ saldoVeiculo: 2_345_678, saldoDemais: 123_456, numeroParcelasVeiculo: 26, frequencia: 'quinzenal', taxaMensal: 0.0199, desconto: 10_000, recebimentoInicial: 400_000, acrescimo: 55_000 }),
    ];
    igual(nov, esperado.novacao, 'novacao');
    // A tela exibe a TR que o motor devolve — e ela reconstrói a taxa do período (Regra 16).
    for (const r of nov) expect(Math.pow(1 + r.taxaMensal, (r === nov[1] ? 30 : r === nov[0] ? 7 : 14) / 30) - 1).toBeCloseTo(r.taxaPeriodo, 14);
    igual([parcelasPorPrazoMeses(60, 'semanal'), parcelasPorPrazoMeses(30, 'quinzenal'), parcelasPorPrazoMeses(24, 'mensal')], esperado.parcelas, 'parcelas');
  });

  it('conciliação do legado (dias por diasCalendarioEntre em vez de difDias)', () => {
    const semana = (n: number) => new Date(Date.UTC(2026, 0, 25) + (n - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
    const termos = { parcelas: { quantidade: 20, valor: 64_200, primeiraEm: '2026-01-25' }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 };
    const base = { valorPago: null as number | null, pagoEm: null as string | null, classe: 'paga' as const, intermediariaEmbutida: 0, parcelamento: 64_200 as number | null, extra: 0, extraRotulo: null as string | null, encargoEmbutido: 0, descricao: null as string | null, tipo: 'parcela' as const };
    const paga = (id: string, venc: string, extra: Record<string, unknown> = {}) => ({ ...base, id, vencimento: venc, valorOriginal: 69_700, valorPago: 69_700, pagoEm: venc, ...extra });
    const cobrancas = [paga('a', semana(1)), paga('b', semana(2)), paga('c', semana(4)), paga('d', semana(5), { classe: 'pendente', valorPago: null, pagoEm: null })];
    igual(conciliarLegado({ termos: termos as never, hoje: semana(5), cobrancas: cobrancas as never }), esperado.conciliacao, 'conciliacao');
    const cob2: unknown[] = [];
    for (let n = 1; n <= 11; n++) cob2.push(paga('p' + n, semana(n)));
    for (let k = 1; k <= 3; k++) cob2.push(paga('ac' + k, semana(12 + k), { valorOriginal: 96_212, valorPago: 96_212, acordo: 26_512, acordoRef: { k, n: 3 }, descricao: 'acordo (' + k + '/3)' }));
    cob2.push(paga('p16', semana(16)));
    igual(conciliarLegado({ termos: termos as never, hoje: semana(17), cobrancas: cob2 as never }), esperado.conciliacao2, 'conciliacao2');
  });
});
