import { describe, expect, it } from 'vitest';
import { planejarReembolsosFaltantes, type FaturaMigrada } from './legado-reembolsos';

// Backfill de Reembolso Parcelado nos contratos migrados (16/10/2026). Dados
// sintéticos reproduzindo os três casos reais: Wallace (declarada, troca de
// óleo 2 × 115,63 — fatura nasceu SEM a despesa), Robson (declarada mensal,
// 1 cota do IPVA 257,00) e Ezequias (regras, filtro de ar 40,00 — total da
// fatura já cheio, itens somam menos).

const PARCELA = 94_200;
const SEGURO = 5_000;
const TAXA = 500;
const PADRAO = PARCELA + SEGURO + TAXA; // 99.700

type Opc = { status?: string; pagoEm?: string | null; encargo?: number; cobrancaValor?: number; cobrancaPago?: number | null; principal?: number; nominal?: number; itensExtras?: FaturaMigrada['itens'] };

function fatura(id: string, numero: number, vencimento: string, o: Opc = {}): FaturaMigrada {
  const status = o.status ?? 'PAGA';
  const paga = status === 'PAGA' || status === 'PAGA_EM_ATRASO';
  const encargo = o.encargo ?? 0;
  const principal = o.principal ?? PARCELA;
  const total = principal + SEGURO + TAXA + (o.itensExtras ?? []).reduce((s, it) => s + it.valor, 0);
  const itens: FaturaMigrada['itens'] = [
    { id: `${id}-p`, tipo: 'PRINCIPAL', descricao: `Parcela ${numero}/48 · Compra Parcelada HB20`, valor: principal, parcelaId: `${id}-pv`, contratoDaParcela: null },
    { id: `${id}-s`, tipo: 'SERVICO', descricao: 'Proteção veicular', valor: SEGURO, parcelaId: null, contratoDaParcela: null },
    { id: `${id}-t`, tipo: 'SERVICO', descricao: 'Taxa de boleto e PIX', valor: TAXA, parcelaId: null, contratoDaParcela: null },
    ...(o.itensExtras ?? []),
  ];
  if (encargo > 0) itens.push({ id: `${id}-e`, tipo: 'ENCARGO', descricao: 'Multa e juros de atraso (legado)', valor: encargo, parcelaId: `${id}-pv`, contratoDaParcela: null });
  const cobrancaValor = o.cobrancaValor ?? total;
  return {
    id, numero, vencimento, status,
    valorTotal: total,
    valorPago: paga ? total + encargo : null,
    pagoEm: paga ? (o.pagoEm ?? vencimento) : null,
    asaasChargeId: `pay_${id}`,
    cobranca: { asaasPaymentId: `pay_${id}`, descricao: 'Parcela', valorOriginal: cobrancaValor, valorPago: paga ? (o.cobrancaPago === undefined ? cobrancaValor + encargo : o.cobrancaPago) : null },
    itens,
    parcelaVeiculo: { id: `${id}-pv`, numero, valorNominal: o.nominal ?? PARCELA, valorPago: paga ? principal + encargo : null },
  };
}

describe('backfill de Reembolso Parcelado — caso Wallace (declarada sem extra: fatura nasceu curta)', () => {
  // Parcelas 9 e 10: cobrança de 1.112,63 = parcela 997,00 + 115,63 "Manutenção troca de
  // óleo"; a 10 foi paga com atraso (encargo 22,62). A declaração não tinha `extra`, logo a
  // fatura migrada vale 997,00 (pago 997,00 / 1.019,62) e a cobrança prova o valor cheio.
  const faturas = [
    fatura('f8', 8, '2025-11-03'),
    fatura('f9', 9, '2025-11-10', { cobrancaValor: PADRAO + 11_563 }),
    fatura('f10', 10, '2025-11-17', { status: 'PAGA_EM_ATRASO', pagoEm: '2025-11-18', encargo: 2_262, cobrancaValor: PADRAO + 11_563 }),
    fatura('f11', 11, '2025-11-24'),
  ];
  const plano = planejarReembolsosFaltantes({ contratoNumero: '202509001', faturas, despesas: [
    { faturaId: 'f10', valor: 11_563, rotulo: 'troca de ÓLEO' },
    { faturaId: 'f9', valor: 11_563, rotulo: 'Troca de óleo' },
  ], rpsExistentes: 0 });

  it('duas semanas consecutivas com o mesmo rótulo formam UM RP de 2 cotas, ENCERRADO por quitação', () => {
    expect(plano.erros).toEqual([]);
    expect(plano.rps).toHaveLength(1);
    const rp = plano.rps[0];
    expect(rp).toMatchObject({ numero: '202509001-RP1', rotulo: 'Troca de óleo', total: 23_126, numeroParcelas: 2, status: 'ENCERRADO', dataAssinatura: '2025-11-10', dataEncerramento: '2025-11-17' });
    expect(rp.cotas.map((c) => [c.n, c.faturaId, c.statusParcela, c.pagoEm, c.descricaoItem])).toEqual([
      [1, 'f9', 'PAGA', '2025-11-10', 'Reembolso Parcelado · Troca de óleo 1/2'],
      [2, 'f10', 'PAGA_EM_ATRASO', '2025-11-18', 'Reembolso Parcelado · Troca de óleo 2/2'],
    ]);
  });

  it('ajuste "faltante": total e pago da fatura sobem no valor da despesa; o encargo não entra na conta', () => {
    expect(plano.ajustes.map((a) => [a.faturaId, a.modo, a.totalAntes, a.totalDepois, a.pagoAntes, a.pagoDepois])).toEqual([
      ['f9', 'faltante', PADRAO, PADRAO + 11_563, PADRAO, PADRAO + 11_563],
      ['f10', 'faltante', PADRAO, PADRAO + 11_563, PADRAO + 2_262, PADRAO + 2_262 + 11_563],
    ]);
    expect(plano.ajustes[0].principal).toBeNull();
    expect(plano.ajustes[0].prova).toContain('pay_f9');
  });

  it('idempotente: com o item já na fatura, nada nasce de novo', () => {
    const jaFeitas = faturas.map((f) => f.id === 'f9' || f.id === 'f10'
      ? { ...f, valorTotal: f.valorTotal + 11_563, itens: [...f.itens, { id: `${f.id}-rp`, tipo: 'PRINCIPAL', descricao: `Reembolso Parcelado · Troca de óleo ${f.id === 'f9' ? 1 : 2}/2`, valor: 11_563, parcelaId: `${f.id}-rpp`, contratoDaParcela: '202509001-RP1' }] }
      : f);
    const de_novo = planejarReembolsosFaltantes({ contratoNumero: '202509001', faturas: jaFeitas, despesas: [{ faturaId: 'f9', valor: 11_563, rotulo: 'Troca de óleo' }, { faturaId: 'f10', valor: 11_563, rotulo: 'Troca de óleo' }], rpsExistentes: 1 });
    expect(de_novo.rps).toEqual([]);
    expect(de_novo.ajustes).toEqual([]);
    expect(de_novo.ignoradas).toHaveLength(2);
    expect(de_novo.erros).toEqual([]);
  });

  it('semanas NÃO consecutivas com o mesmo rótulo viram RPs separados e a numeração continua', () => {
    const fs = [fatura('f8', 8, '2025-11-03', { cobrancaValor: PADRAO + 11_563 }), fatura('f9', 9, '2025-11-10'), fatura('f10', 10, '2025-11-17', { cobrancaValor: PADRAO + 11_563 })];
    const p = planejarReembolsosFaltantes({ contratoNumero: '202509001', faturas: fs, despesas: [{ faturaId: 'f8', valor: 11_563, rotulo: 'Troca de óleo' }, { faturaId: 'f10', valor: 11_563, rotulo: 'Troca de óleo' }], rpsExistentes: 2 });
    expect(p.rps.map((r) => [r.numero, r.numeroParcelas])).toEqual([['202509001-RP3', 1], ['202509001-RP4', 1]]);
  });
});

describe('backfill — caso Robson (declarada mensal, 1 cota do IPVA 2026 R$ 257,00)', () => {
  it('uma despesa única vira RP de 1 cota, paga, ENCERRADO no próprio vencimento', () => {
    const faturas = [fatura('m1', 1, '2026-01-12'), fatura('m2', 2, '2026-02-12', { cobrancaValor: PADRAO + 25_700 }), fatura('m3', 3, '2026-03-12')];
    const p = planejarReembolsosFaltantes({ contratoNumero: '2026010007', faturas, despesas: [{ faturaId: 'm2', valor: 25_700, rotulo: '1ª Cota do IPVA 2026' }], rpsExistentes: 0 });
    expect(p.erros).toEqual([]);
    expect(p.rps).toHaveLength(1);
    expect(p.rps[0]).toMatchObject({ numero: '2026010007-RP1', rotulo: '1ª Cota do IPVA 2026', total: 25_700, numeroParcelas: 1, status: 'ENCERRADO', dataAssinatura: '2026-02-12', dataEncerramento: '2026-02-12' });
    expect(p.rps[0].cotas[0].descricaoItem).toBe('Reembolso Parcelado · 1ª Cota do IPVA 2026 1/1');
    expect(p.ajustes[0]).toMatchObject({ modo: 'faltante', totalDepois: PADRAO + 25_700, pagoDepois: PADRAO + 25_700 });
  });

  it('o rótulo perde "(1/5)" e "3/6" como no planner da migração', () => {
    const faturas = [fatura('m2', 2, '2026-02-12', { cobrancaValor: PADRAO + 25_700 })];
    const p = planejarReembolsosFaltantes({ contratoNumero: 'X', faturas, despesas: [{ faturaId: 'm2', valor: 25_700, rotulo: 'IPVA 2026 (1/3)' }], rpsExistentes: 0 });
    expect(p.rps[0].rotulo).toBe('IPVA 2026');
  });
});

describe('backfill — caso Ezequias (regras, "Reembolso filtro de ar R$ 40,00" não lido)', () => {
  // Pelas regras a cobrança inteira virou total da fatura (cobrado), mas o principal ficou
  // no valor do contrato: os itens somam 40,00 a menos que o total — é "folga".
  it('ajuste "folga": só o item do RP entra; total, pago e principal ficam como estão', () => {
    const f = fatura('e1', 12, '2025-11-17');
    f.valorTotal += 4_000; f.valorPago! += 4_000; f.cobranca!.valorOriginal += 4_000; f.cobranca!.valorPago! += 4_000;
    const p = planejarReembolsosFaltantes({ contratoNumero: '202508003', faturas: [fatura('e0', 11, '2025-11-10'), f], despesas: [{ faturaId: 'e1', valor: 4_000, rotulo: 'Filtro de ar' }], rpsExistentes: 0 });
    expect(p.erros).toEqual([]);
    expect(p.rps[0]).toMatchObject({ numero: '202508003-RP1', rotulo: 'Filtro de ar', total: 4_000, status: 'ENCERRADO' });
    expect(p.ajustes[0]).toMatchObject({ modo: 'folga', totalAntes: PADRAO + 4_000, totalDepois: PADRAO + 4_000, pagoAntes: PADRAO + 4_000, pagoDepois: PADRAO + 4_000, principal: null, parcelaVeiculo: null });
  });
});

describe('backfill — principal absorveu a despesa e proteções', () => {
  it('ajuste "principal": itens batem com o total e a cobrança vale o mesmo — o principal diminui', () => {
    // Declarada com `valor` cheio: principal = 942,00 + 40,00 e nominal da parcela também.
    const f = fatura('a1', 5, '2025-12-01', { principal: PARCELA + 4_000, nominal: PARCELA + 4_000 });
    const p = planejarReembolsosFaltantes({ contratoNumero: 'C', faturas: [f], despesas: [{ faturaId: 'a1', valor: 4_000, rotulo: 'Filtro de ar' }], rpsExistentes: 0 });
    expect(p.erros).toEqual([]);
    expect(p.ajustes[0]).toMatchObject({ modo: 'principal', totalAntes: PADRAO + 4_000, totalDepois: PADRAO + 4_000, principal: { itemId: 'a1-p', antes: PARCELA + 4_000, depois: PARCELA }, parcelaVeiculo: { id: 'a1-pv', nominalAntes: PARCELA + 4_000, nominalDepois: PARCELA, pagoAntes: PARCELA + 4_000, pagoDepois: PARCELA } });
  });

  it('ajuste "principal" com nominal já certo: só o pago da parcela e o item mudam', () => {
    const f = fatura('a2', 5, '2025-12-01', { principal: PARCELA + 4_000, nominal: PARCELA });
    const p = planejarReembolsosFaltantes({ contratoNumero: 'C', faturas: [f], despesas: [{ faturaId: 'a2', valor: 4_000, rotulo: 'Filtro de ar' }], rpsExistentes: 0 });
    expect(p.ajustes[0].parcelaVeiculo).toMatchObject({ nominalAntes: PARCELA, nominalDepois: PARCELA, pagoAntes: PARCELA + 4_000, pagoDepois: PARCELA });
  });

  it('não adivinha: folga diferente da despesa, cobrança que não bate, fatura ABERTA ou sem cobrança são ERRO', () => {
    const folgaErrada = fatura('x1', 1, '2025-10-06'); folgaErrada.valorTotal += 3_000;
    const cobrancaNaoBate = fatura('x2', 2, '2025-10-13', { cobrancaValor: PADRAO + 9_999 });
    const aberta = fatura('x3', 3, '2026-12-14', { status: 'ABERTA', cobrancaValor: PADRAO + 4_000 });
    const semCobranca = { ...fatura('x4', 4, '2025-10-27', { cobrancaValor: PADRAO + 4_000 }), cobranca: null };
    const p = planejarReembolsosFaltantes({ contratoNumero: 'C', faturas: [folgaErrada, cobrancaNaoBate, aberta, semCobranca], despesas: [
      { faturaId: 'x1', valor: 4_000, rotulo: 'Filtro' }, { faturaId: 'x2', valor: 4_000, rotulo: 'Filtro' }, { faturaId: 'x3', valor: 4_000, rotulo: 'Filtro' }, { faturaId: 'x4', valor: 4_000, rotulo: 'Filtro' }, { faturaId: 'nao-existe', valor: 1, rotulo: 'Z' }, { faturaId: 'x1', valor: 0, rotulo: '' },
    ], rpsExistentes: 0 });
    expect(p.rps).toEqual([]);
    expect(p.erros.map((e) => e.faturaId)).toEqual(['x1', 'x2', 'x3', 'x4', 'nao-existe', 'x1']);
    expect(p.erros[0].motivo).toMatch(/folga de R\$\s30,00/); // Intl usa espaço não-separável
    expect(p.erros[1].motivo).toMatch(/não há leitura consistente/);
    expect(p.erros[2].motivo).toMatch(/ABERTA/);
    expect(p.erros[3].motivo).toMatch(/sem cobrança/);
  });

  it('faltante com pago da cobrança divergente do pago da fatura + despesa é ERRO', () => {
    const f = fatura('y1', 1, '2025-10-06', { cobrancaValor: PADRAO + 4_000, cobrancaPago: PADRAO + 1_000 });
    const p = planejarReembolsosFaltantes({ contratoNumero: 'C', faturas: [f], despesas: [{ faturaId: 'y1', valor: 4_000, rotulo: 'Filtro' }], rpsExistentes: 0 });
    expect(p.rps).toEqual([]);
    expect(p.erros[0].motivo).toMatch(/pago na cobrança/);
  });

  it('cota em fatura FECHADA (vencida, cobrança antiga amarrada) nasce em aberto e o RP fica ATIVO', () => {
    const f = fatura('v1', 1, '2026-09-28', { status: 'FECHADA', cobrancaValor: PADRAO + 4_000 });
    const p = planejarReembolsosFaltantes({ contratoNumero: 'C', faturas: [f], despesas: [{ faturaId: 'v1', valor: 4_000, rotulo: 'Filtro' }], rpsExistentes: 0 });
    expect(p.rps[0]).toMatchObject({ status: 'ATIVO', dataEncerramento: null });
    expect(p.rps[0].cotas[0]).toMatchObject({ paga: false, statusParcela: null, pagoEm: null });
    expect(p.ajustes[0]).toMatchObject({ modo: 'faltante', pagoAntes: null, pagoDepois: null, totalDepois: PADRAO + 4_000 });
  });
});
