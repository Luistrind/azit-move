import { Prisma } from '@prisma/client';
import { formatCurrency } from '@azit/utils';
import { RenegociacaoService } from './renegociacao.service';

// Detalhe do acordo (tela Renegociações, 21/10/2026): o que o operador vê ao
// clicar — parcelas cobertas com a composição da fatura, entrada, cotas novas
// com situação e a trilha. Dois casos reais de produção como fixture:
// Leonardo 202512005 (importado do legado, 20 cotas de 281,65, 5 parcelas
// cobertas de 22/07 a 19/08, entrada de 1.500) e um acordo nativo que passou
// pela Central de Aprovações. Sem banco: o Prisma é um dublê.

const HOJE = '2026-10-14'; // quarta-feira
beforeAll(() => { jest.useFakeTimers({ now: new Date(`${HOJE}T15:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

const dec = (reais: number) => new Prisma.Decimal(reais.toFixed(2));
const dia = (iso: string) => new Date(`${iso}T03:00:00.000Z`); // mesmo dia-calendário em UTC (CI) e em Brasília (máquina local)
const somarDias = (iso: string, n: number) => new Date(dia(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const ativoLeo = { descricao: 'Fiat Mobi 2023', placa: 'ABC1D23' };
const contratoLeo = { id: 'c-leo', numero: '202512005', ativo: ativoLeo };

function parcela(p: {
  id: string; contratoId: string; itemContratadoId: string; numero: number; totalParcelas: number; venc: string;
  valor: number; status?: 'PAGA' | 'PAGA_EM_ATRASO' | 'NOVADA' | null; pagoEm?: string | null; encargo?: number; faturaId?: string | null; acordoId?: string | null;
}) {
  return {
    id: p.id, contratoId: p.contratoId, itemContratadoId: p.itemContratadoId, numero: p.numero, totalParcelas: p.totalParcelas,
    display: `${p.numero}/${p.totalParcelas}`, valorNominal: dec(p.valor), dataVencimento: dia(p.venc),
    dataPagamento: p.pagoEm ? dia(p.pagoEm) : null, valorPago: p.pagoEm ? dec(p.valor + (p.encargo ?? 0)) : null,
    valorEncargo: p.encargo ? dec(p.encargo) : null, status: p.status ?? null, faturaId: p.faturaId ?? null, acordoId: p.acordoId ?? null,
    createdAt: dia('2026-10-01'), updatedAt: dia('2026-10-01'), deletedAt: null,
  };
}

function faturaRenegociada(id: string, numero: number, venc: string, parcelaId: string, principal: number) {
  return {
    id, numero, dataVencimento: dia(venc), status: 'RENEGOCIADA', valorTotal: dec(principal + 50), valorPago: null, dataPagamento: null,
    itensFatura: [
      { parcelaId, descricao: `Parcela ${numero}/48 · Compra Parcelada Fiat Mobi 2023`, tipo: 'PRINCIPAL', valor: dec(principal), credor: 'AZIT' },
      { parcelaId: null, descricao: 'Proteção veicular', tipo: 'SERVICO', valor: dec(50), credor: 'AZIT' },
    ],
  };
}

function montar(acordo: unknown, extras: { aprovacao?: unknown; faturasSnap?: unknown[]; novacao?: unknown } = {}) {
  const prisma = {
    db: {
      acordo: { findFirst: jest.fn().mockResolvedValue(acordo) },
      aprovacao: { findFirst: jest.fn().mockResolvedValue(extras.aprovacao ?? null) },
      fatura: { findMany: jest.fn().mockResolvedValue(extras.faturasSnap ?? []) },
      novacao: { findFirst: jest.fn().mockResolvedValue(extras.novacao ?? null) },
    },
  };
  const service = new RenegociacaoService(prisma as never, {} as never, {} as never, {} as never);
  return { service, prisma };
}

describe('detalhe do acordo — importado do legado (Leonardo 202512005)', () => {
  // 5 parcelas semanais cobertas (22/07 → 19/08), cada uma na sua fatura RENEGOCIADA
  // com a proteção junto; entrada de 1.500 paga em 26/08; 20 cotas de 281,65 a
  // partir de 27/08: 4 pagas, 3 vencidas (24/09, 01/10, 08/10) e 13 a vencer.
  const vencCobertas = ['2026-07-22', '2026-07-29', '2026-08-05', '2026-08-12', '2026-08-19'];
  const cobertas = vencCobertas.map((venc, i) => ({
    ...parcela({ id: `p-${5 + i}`, contratoId: 'c-leo', itemContratadoId: 'item-veic', numero: 5 + i, totalParcelas: 48, venc, valor: 699, faturaId: `f-${5 + i}`, acordoId: 'ac-leo' }),
    contrato: contratoLeo,
    fatura: faturaRenegociada(`f-${5 + i}`, 5 + i, venc, `p-${5 + i}`, 699),
  }));
  const cotas = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    const venc = somarDias('2026-08-27', 7 * i);
    const paga = n <= 4;
    return {
      ...parcela({ id: `cota-${n}`, contratoId: 'c-leo', itemContratadoId: 'item-acordo', numero: n, totalParcelas: 20, venc, valor: 281.65, status: paga ? 'PAGA' : null, pagoEm: paga ? venc : null, faturaId: `f-cota-${n}` }),
      fatura: { id: `f-cota-${n}`, numero: 100 + n, dataVencimento: dia(venc), status: paga ? 'PAGA' : venc < HOJE ? 'FECHADA' : 'ABERTA', dataPagamento: paga ? dia(venc) : null },
    };
  });
  const acordo = {
    id: 'ac-leo', status: 'ATIVO', contaId: 'conta-leo', contratoId: 'c-leo', operadorId: 'u-luis', observacao: 'Acordo em andamento importado do legado (conciliação declarada)',
    dataCriacao: dia('2026-08-26'), dataEfetivacao: dia('2026-08-26'), createdAt: new Date('2026-10-20T18:00:00.000Z'), updatedAt: new Date('2026-10-20T18:00:00.000Z'), deletedAt: null,
    valorTotalRenegociado: dec(3495), valorEntrada: dec(1500), numeroParcelasNovas: 20, valorParcelaNova: dec(281.65), periodicidade: 'SEMANAL', asaasChargeIdEntrada: 'pay_entrada',
    snapshotJson: { legado: { casoId: 'caso-leo', parcelasCobertas: [5, 6, 7, 8, 9], primeiraEm: '2026-08-27', ultimaEm: '2027-01-07', declarado: true } },
    conta: { id: 'conta-leo', titular: { id: 't-leo', nome: 'Leonardo Assis de Almeida' } },
    operador: { nome: 'Luís' },
    contrato: contratoLeo,
    parcelasCobertas: cobertas,
    itensGerados: [{ id: 'item-acordo', contrato: contratoLeo, parcelas: cotas }],
    lancamentos: [{ id: 'l-1', tipo: 'ENTRADA_ACORDO', descricao: 'Entrada do acordo de renegociação (legado)', valor: dec(1500), dataPagamento: dia('2026-08-26'), asaasChargeId: 'pay_entrada' }],
  };

  it('mostra as 5 parcelas cobertas com o conteúdo da fatura, a entrada e as 20 cotas com situação', async () => {
    const { service, prisma } = montar(acordo);
    const d = await service.detalhar('ac-leo');

    expect(d.origem).toBe('legado');
    expect(d.status).toBe('ativo');
    expect(d.contratos).toEqual([{ id: 'c-leo', numero: '202512005', descricao: 'Fiat Mobi 2023', placa: 'ABC1D23' }]);
    expect(d.plano).toEqual({ valorTotalRenegociado: 349_500, valorEntrada: 150_000, numeroParcelasNovas: 20, valorParcelaNova: 28_165, periodicidade: 'semanal', totalPlano: 563_300 });

    // Parcelas cobertas — uma fatura por parcela, cada fatura com a proteção junto.
    expect(d.faturasCobertas).toHaveLength(5);
    expect(d.faturasCobertas.map((f) => f.dataVencimento)).toEqual(vencCobertas);
    const primeira = d.faturasCobertas[0];
    expect(primeira.status).toBe('renegociada');
    expect(primeira.parcelas[0]).toMatchObject({ display: '5/48', valorNominal: 69_900, status: 'Em acordo', contratoNumero: '202512005' });
    // Dias de atraso na data-base (entrada paga em 26/08): 22/07 → 35 dias.
    expect(primeira.parcelas[0].diasAtrasoNaDataBase).toBe(35);
    expect(primeira.itens).toEqual([
      { descricao: 'Parcela 5/48 · Compra Parcelada Fiat Mobi 2023', tipo: 'principal', valor: 69_900, credor: 'azit', coberto: true },
      { descricao: 'Proteção veicular', tipo: 'servico', valor: 5_000, credor: 'azit', coberto: false },
    ]);
    expect(d.cobertasSemFatura).toHaveLength(0);
    // Legado não tem snapshot de saldos: só o nominal coberto é conhecido.
    expect(d.totaisCobertura).toEqual({ quantidadeParcelas: 5, quantidadeFaturas: 5, valorNominal: 349_500, encargosMora: null, valorAtualizado: null, moraHerdada: null });

    // Entrada paga (lançamento ENTRADA_ACORDO).
    expect(d.entrada).toEqual({ valor: 150_000, dataLimite: null, pagaEm: dia('2026-08-26').toISOString(), cobrancaAsaasId: 'pay_entrada', situacao: 'paga' });

    // Cotas: 4 pagas, 3 vencidas, 13 a vencer; saldo pago × a pagar.
    expect(d.cotas).toHaveLength(20);
    expect(d.cotas[0]).toMatchObject({ display: '1/20', dataVencimento: '2026-08-27', valorNominal: 28_165, status: 'Paga', dataPagamento: '2026-08-27', fatura: { numero: 101, status: 'paga' } });
    expect(d.cotas[4]).toMatchObject({ display: '5/20', dataVencimento: '2026-09-24', status: 'Vencida' });
    expect(d.cotas[7]).toMatchObject({ display: '8/20', dataVencimento: '2026-10-15', status: 'Em aberto' });
    expect(d.resumoCotas).toEqual({
      quantidade: 20, pagas: 4, vencidas: 3, venceHoje: 0, aVencer: 13, novadas: 0,
      valorPago: 4 * 28_165, encargosPagos: 0, valorAPagar: 16 * 28_165, valorVencido: 3 * 28_165, totalPlano: 563_300,
    });

    // Snapshot do legado: as parcelas declaradas e as datas das cotas.
    expect(d.legado).toEqual({ casoId: 'caso-leo', parcelasCobertasDeclaradas: [5, 6, 7, 8, 9], primeiraCotaEm: '2026-08-27', ultimaCotaEm: '2027-01-07' });
    expect(d.exclusoes).toEqual([]);
    expect(d.calculo).toBeNull();
    expect(d.aprovacao).toBeNull();

    // Trilha: firmado no legado (data da entrada) → importado pela migração; sem "efetivado" nativo.
    expect(d.trilha.map((e) => e.titulo)).toEqual(['Acordo firmado no legado (Asaas)', 'Entrada paga', 'Importado pela migração do legado']);
    expect(d.trilha[2].por).toBe('Luís');
    // Nenhum id interno no texto da trilha.
    for (const e of d.trilha) expect(`${e.titulo} ${e.detalhe ?? ''}`).not.toMatch(/\b(ac|c|p|f)-[a-z0-9]+\b/);
    // Legado não consulta a Central nem faturas do snapshot.
    expect(prisma.db.fatura.findMany).not.toHaveBeenCalled();
  });

  it('acordo cumprido: a trilha fecha com "Acordo cumprido" na data da última cota paga', async () => {
    const todasPagas = cotas.map((c) => ({ ...c, status: 'PAGA', dataPagamento: c.dataVencimento, valorPago: c.valorNominal }));
    const { service } = montar({ ...acordo, status: 'CUMPRIDO', itensGerados: [{ id: 'item-acordo', contrato: contratoLeo, parcelas: todasPagas }] });
    const d = await service.detalhar('ac-leo');
    expect(d.resumoCotas.pagas).toBe(20);
    expect(d.resumoCotas.valorAPagar).toBe(0);
    const ultimo = d.trilha[d.trilha.length - 1];
    expect(ultimo.titulo).toBe('Acordo cumprido');
    expect(ultimo.em).toBe('2027-01-07T12:00:00.000Z');
  });
});

describe('detalhe do acordo — nativo, aprovado na Central', () => {
  // Conta com 2 faturas vencidas selecionadas e 1 excluída com justificativa;
  // entrada de 400 com data-limite; 4 cotas de 407,94: 2 pagas, 2 a vencer.
  const contratoA = { id: 'c-a', numero: '2026090010', ativo: { descricao: 'VW Polo 2022', placa: 'XYZ9A87' } };
  const contratoRp = { id: 'c-rp', numero: '2026090010-RP1', ativo: null };
  const cobertas = [
    { ...parcela({ id: 'p-a-10', contratoId: 'c-a', itemContratadoId: 'i-a', numero: 10, totalParcelas: 48, venc: '2026-09-07', valor: 699, faturaId: 'f-1', acordoId: 'ac-1' }), contrato: contratoA, fatura: faturaRenegociada('f-1', 10, '2026-09-07', 'p-a-10', 699) },
    { ...parcela({ id: 'p-rp-2', contratoId: 'c-rp', itemContratadoId: 'i-rp', numero: 2, totalParcelas: 6, venc: '2026-09-07', valor: 120, faturaId: 'f-1', acordoId: 'ac-1' }), contrato: contratoRp, fatura: faturaRenegociada('f-1', 10, '2026-09-07', 'p-a-10', 699) },
    { ...parcela({ id: 'p-a-11', contratoId: 'c-a', itemContratadoId: 'i-a', numero: 11, totalParcelas: 48, venc: '2026-09-14', valor: 699, faturaId: 'f-2', acordoId: 'ac-1' }), contrato: contratoA, fatura: faturaRenegociada('f-2', 11, '2026-09-14', 'p-a-11', 699) },
  ];
  const cotasA = [1, 2, 3, 4].map((n) => ({
    ...parcela({ id: `ca-${n}`, contratoId: 'c-a', itemContratadoId: 'ia-acordo', numero: n, totalParcelas: 4, venc: somarDias('2026-09-28', 7 * (n - 1)), valor: 350, status: n <= 2 ? 'PAGA_EM_ATRASO' : null, pagoEm: n <= 2 ? somarDias('2026-09-28', 7 * (n - 1) + 2) : null, encargo: n <= 2 ? 3.5 : 0, faturaId: `fa-${n}` }),
    fatura: { id: `fa-${n}`, numero: 20 + n, dataVencimento: dia(somarDias('2026-09-28', 7 * (n - 1))), status: n <= 2 ? 'PAGA_EM_ATRASO' : 'ABERTA', dataPagamento: null },
  }));
  const cotasRp = [1, 2, 3, 4].map((n) => ({
    ...parcela({ id: `crp-${n}`, contratoId: 'c-rp', itemContratadoId: 'irp-acordo', numero: n, totalParcelas: 4, venc: somarDias('2026-09-28', 7 * (n - 1)), valor: 57.94, status: n <= 2 ? 'PAGA' : null, pagoEm: n <= 2 ? somarDias('2026-09-28', 7 * (n - 1)) : null, faturaId: `fa-${n}` }),
    fatura: { id: `fa-${n}`, numero: 20 + n, dataVencimento: dia(somarDias('2026-09-28', 7 * (n - 1))), status: n <= 2 ? 'PAGA_EM_ATRASO' : 'ABERTA', dataPagamento: null },
  }));
  const snapshot = {
    dataBase: '2026-09-20T13:00:00.000Z',
    faturasSelecionadas: ['f-1', 'f-2'],
    exclusoes: [{ faturaId: 'f-3', justificativa: 'Cliente contesta a proteção desta semana — em apuração' }],
    vincendasIncluidas: ['f-2'],
    totais: { valorNominal: 151_800, encargosMora: 4_200, valorAtualizado: 156_000 },
    moraHerdada: 'multa e juros da regra geral do contrato na data-base (RAP007)',
    calculo: { motor: 'catalogo', periodicidade: 'semanal', saldoNegociado: 156_000, entradaMinima: 46_800, taxaInicial: 15_584, taxaPeriodo: 0.0115, encargoMensal: 0.0499, saldoAParcelar: 123_176, valorParcela: 40_794, totalAPagar: 203_176, excecoes: ['entrada abaixo do mínimo de 30% (R$ 468,00)'] },
    dataLimiteEntrada: '2026-09-25T15:00:00.000Z',
    aceiteWhatsapp: { confirmadoPeloOperadorEm: '2026-09-20T13:00:00.000Z' },
  };
  const acordo = {
    id: 'ac-1', status: 'ATIVO', contaId: 'conta-a', contratoId: null, operadorId: 'u-ana', observacao: null,
    dataCriacao: new Date('2026-09-20T13:00:00.000Z'), dataEfetivacao: new Date('2026-09-24T17:30:00.000Z'), createdAt: new Date('2026-09-20T13:00:00.000Z'), updatedAt: new Date('2026-09-24T17:30:00.000Z'), deletedAt: null,
    valorTotalRenegociado: dec(1560), valorEntrada: dec(400), numeroParcelasNovas: 4, valorParcelaNova: dec(407.94), periodicidade: 'SEMANAL', asaasChargeIdEntrada: 'pay_ent_1',
    snapshotJson: snapshot,
    conta: { id: 'conta-a', titular: { id: 't-a', nome: 'Cliente Nativo' } },
    operador: { nome: 'Ana' },
    contrato: null,
    parcelasCobertas: cobertas,
    itensGerados: [
      { id: 'ia-acordo', contrato: contratoA, parcelas: cotasA },
      { id: 'irp-acordo', contrato: contratoRp, parcelas: cotasRp },
    ],
    lancamentos: [{ id: 'l-1', tipo: 'ENTRADA_ACORDO', descricao: 'Entrada do acordo de renegociação', valor: dec(400), dataPagamento: new Date('2026-09-24T17:30:00.000Z'), asaasChargeId: 'pay_ent_1' }],
  };
  const aprovacao = {
    id: 'ap-1', status: 'APROVADA', resumo: 'Renegociação de 2 fatura(s) — entrada R$ 400,00 + 4× R$ 407,94 (semanal) · ⚠ EXCEÇÕES: entrada abaixo do mínimo de 30% (R$ 468,00)',
    createdAt: new Date('2026-09-20T13:00:05.000Z'), updatedAt: new Date('2026-09-21T10:00:00.000Z'),
    solicitante: { nome: 'Ana' },
    decisoes: [
      { decisao: 'RECOMENDADA', parecer: 'Cliente histórico bom, entrada menor por perda de renda', createdAt: new Date('2026-09-20T16:00:00.000Z'), usuario: { nome: 'Bruno' } },
      { decisao: 'APROVADA', parecer: null, createdAt: new Date('2026-09-21T10:00:00.000Z'), usuario: { nome: 'Arthur' } },
    ],
  };
  const faturasSnap = [
    { id: 'f-3', numero: 12, dataVencimento: dia('2026-09-21'), valorTotal: dec(749) },
    { id: 'f-2', numero: 11, dataVencimento: dia('2026-09-14'), valorTotal: dec(749) },
  ];

  it('agrupa as cobertas por fatura (2 contratos na mesma fatura), traz exclusões com justificativa, saldos da data-base e a trilha da Central', async () => {
    const { service, prisma } = montar(acordo, { aprovacao, faturasSnap });
    const d = await service.detalhar('ac-1');

    expect(d.origem).toBe('nativo');
    expect(d.contratos.map((c) => c.numero)).toEqual(['2026090010', '2026090010-RP1']);
    expect(d.contratos[1]).toMatchObject({ descricao: 'Reembolso Parcelado', placa: null });

    // Fatura f-1 carrega a parcela do veículo E a do RP; f-2 só a do veículo.
    expect(d.faturasCobertas).toHaveLength(2);
    expect(d.faturasCobertas[0].parcelas.map((p) => `${p.contratoNumero} ${p.display}`)).toEqual(['2026090010 10/48', '2026090010-RP1 2/6']);
    expect(d.faturasCobertas[0].diasAtrasoNaDataBase).toBe(13); // 07/09 → 20/09
    expect(d.faturasCobertas[1].parcelas).toHaveLength(1);
    expect(d.totaisCobertura).toEqual({ quantidadeParcelas: 3, quantidadeFaturas: 2, valorNominal: 151_800, encargosMora: 4_200, valorAtualizado: 156_000, moraHerdada: snapshot.moraHerdada });

    // Exclusão e vincenda incluída resolvidas para número/vencimento da fatura.
    expect(prisma.db.fatura.findMany).toHaveBeenCalledWith({ where: { id: { in: ['f-3', 'f-2'] } }, select: { id: true, numero: true, dataVencimento: true, valorTotal: true } });
    expect(d.exclusoes).toEqual([{ faturaId: 'f-3', numero: 12, dataVencimento: '2026-09-21', valorTotal: 74_900, justificativa: 'Cliente contesta a proteção desta semana — em apuração' }]);
    expect(d.vincendasIncluidas).toEqual([{ faturaId: 'f-2', numero: 11, dataVencimento: '2026-09-14', valorTotal: 74_900 }]);
    expect(d.calculo?.motor).toBe('catalogo');
    expect(d.aceiteWhatsapp).toEqual({ confirmadoPeloOperadorEm: '2026-09-20T13:00:00.000Z' });

    // Entrada com data-limite, paga pelo lançamento.
    expect(d.entrada).toEqual({ valor: 40_000, dataLimite: '2026-09-25T15:00:00.000Z', pagaEm: '2026-09-24T17:30:00.000Z', cobrancaAsaasId: 'pay_ent_1', situacao: 'paga' });

    // Cotas rateadas por contrato (veículo 350 + RP 57,94 = 407,94), ordenadas por número.
    expect(d.cotas.map((c) => `${c.contratoNumero} ${c.display} ${c.status}`)).toEqual([
      '2026090010 1/4 Paga em atraso', '2026090010-RP1 1/4 Paga', '2026090010 2/4 Paga em atraso', '2026090010-RP1 2/4 Paga',
      '2026090010 3/4 Vencida', '2026090010-RP1 3/4 Vencida', '2026090010 4/4 Em aberto', '2026090010-RP1 4/4 Em aberto',
    ]);
    expect(d.resumoCotas).toEqual({
      quantidade: 8, pagas: 4, vencidas: 2, venceHoje: 0, aVencer: 2, novadas: 0,
      valorPago: 2 * 35_000 + 2 * 5_794, encargosPagos: 2 * 350, valorAPagar: 2 * 35_000 + 2 * 5_794, valorVencido: 35_000 + 5_794, totalPlano: 163_176,
    });

    // Trilha em ordem: proposta → Central → Bruno recomendou → Arthur aprovou →
    // cobrança da entrada → entrada paga → efetivado.
    expect(d.trilha.map((e) => e.titulo)).toEqual([
      'Proposta de acordo criada', 'Enviado à Central de Aprovações', 'Bruno recomendou a aprovação', 'Arthur aprovou',
      'Aprovado — cobrança da entrada gerada no Asaas', 'Entrada paga', 'Acordo efetivado',
    ]);
    expect(d.trilha[0]).toMatchObject({ por: 'Ana', detalhe: `2 fatura(s) renegociada(s) · entrada ${formatCurrency(40_000)} · 4× ${formatCurrency(40_794)} (semanal) · de acordo do cliente registrado (WhatsApp)` });
    expect(d.trilha[2].detalhe).toBe('Cliente histórico bom, entrada menor por perda de renda');
    expect(d.trilha[4].detalhe).toContain('25/09/2026');
    expect(d.trilha[6].detalhe).toBe('3 parcela(s) coberta(s) recebeu(ram) o vínculo do acordo, 2 fatura(s) viraram "Renegociada" e 8 cota(s) nova(s) entraram nas faturas seguintes');
    expect(d.aprovacao?.decisoes.map((x) => x.usuario)).toEqual(['Bruno', 'Arthur']);
  });

  it('proposta reprovada: entrada não paga, acordo cancelado com o motivo da Central', async () => {
    const reprovada = { ...aprovacao, status: 'REPROVADA', decisoes: [{ decisao: 'REPROVADA', parecer: 'Entrada insuficiente', createdAt: new Date('2026-09-21T10:00:00.000Z'), usuario: { nome: 'Arthur' } }] };
    const { service } = montar({ ...acordo, status: 'CANCELADO', dataEfetivacao: null, parcelasCobertas: [], itensGerados: [], lancamentos: [] }, { aprovacao: reprovada, faturasSnap });
    const d = await service.detalhar('ac-1');
    expect(d.entrada.situacao).toBe('nao_paga');
    expect(d.resumoCotas.quantidade).toBe(0);
    expect(d.trilha.map((e) => e.titulo)).toEqual(['Proposta de acordo criada', 'Enviado à Central de Aprovações', 'Arthur reprovou', 'Acordo cancelado']);
    expect(d.trilha[3].detalhe).toBe('Reprovado na Central de Aprovações');
  });

  it('aguardando entrada: situação da entrada e sem efetivação', async () => {
    const { service } = montar({ ...acordo, status: 'AGUARDANDO_ENTRADA', dataEfetivacao: null, parcelasCobertas: [], itensGerados: [], lancamentos: [] }, { aprovacao, faturasSnap });
    const d = await service.detalhar('ac-1');
    expect(d.entrada.situacao).toBe('aguardando');
    expect(d.entrada.pagaEm).toBeNull();
    expect(d.trilha.map((e) => e.titulo)).not.toContain('Acordo efetivado');
  });

  it('acordo inexistente → 404', async () => {
    const { service } = montar(null);
    await expect(service.detalhar('nada')).rejects.toMatchObject({ response: { erro: 'nao_encontrado' } });
  });
});
