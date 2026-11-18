import { Prisma } from '@prisma/client';
import { FaturaService } from './fatura.service';

// Ficha do titular (doc 02 §33): faturas por visão, posição de hoje e pagamentos
// da conta. Sem banco — o que se confere é a regra de cada leitura.

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dec = (v: number | null) => (v == null ? null : new Prisma.Decimal(v));

function fatura(id: string, status: string, o: Partial<{ modeloEncargo: string; valorTotal: number; valorPago: number | null; venc: string; token: string | null }> = {}) {
  return {
    id,
    numero: Number(id.replace(/\D/g, '')) || 1,
    periodoReferencia: dia(o.venc ?? '2026-11-02'),
    dataVencimento: dia(o.venc ?? '2026-11-02'),
    dataFechamento: null,
    dataPagamento: null,
    status,
    valorTotal: dec(o.valorTotal ?? 849)!,
    valorPago: dec(o.valorPago ?? null),
    asaasChargeId: null,
    modeloEncargo: o.modeloEncargo ?? 'ASAAS_NATIVO',
    tokenPublico: o.token ?? null,
    itensFatura: [],
  };
}

type Linha = ReturnType<typeof fatura>;

function montar(
  p: {
    agora?: Linha[];
    vencer?: Linha[];
    pagas?: Linha[];
    motor?: Record<string, { totalHoje: number; multa: number; atualizacao: number }>;
    pagamentos?: unknown[];
    semRegistro?: unknown[];
    lancamentos?: unknown[];
  } = {},
) {
  const lista = (where: Prisma.FaturaWhereInput): unknown[] => {
    if ('pagamentos' in where) return p.semRegistro ?? [];
    if ('OR' in where) return p.agora ?? [];
    if (where.status === 'ABERTA') return p.vencer ?? [];
    const s = (where.status as { in: string[] }).in;
    return s.includes('PAGA') ? (p.pagas ?? []) : [];
  };
  const db = {
    fatura: {
      count: jest.fn(async ({ where }: { where: Prisma.FaturaWhereInput }) => lista(where).length),
      findMany: jest.fn(async ({ where, skip, take }: { where: Prisma.FaturaWhereInput; skip?: number; take?: number }) =>
        lista(where).slice(skip ?? 0, (skip ?? 0) + (take ?? 999)),
      ),
      aggregate: jest.fn(async () => ({
        _count: { _all: (p.vencer ?? []).length },
        _sum: { valorTotal: dec((p.vencer ?? []).reduce((s, f) => s + Number(f.valorTotal), 0)), valorPago: dec(0) },
      })),
    },
    pagamentoFatura: { findMany: jest.fn(async () => p.pagamentos ?? []) },
    lancamentoConta: { findMany: jest.fn(async () => p.lancamentos ?? []) },
  };
  const contaFatura = {
    carregar: jest.fn().mockResolvedValue({ faturas: [] }),
    projetar: jest.fn().mockReturnValue({
      faturas: Object.entries(p.motor ?? {}).map(([id, m]) => ({ id, totalHoje: m.totalHoje, encargo: { multa: m.multa, atualizacao: m.atualizacao } })),
    }),
  };
  const service = new FaturaService(
    { db } as never,
    {} as never,
    { get: () => 'https://fatura.exemplo' } as never,
    {} as never,
    {} as never,
    contaFatura as never,
    {} as never,
    { add: jest.fn() } as never,
    { add: jest.fn() } as never,
  );
  return { service, db, contaFatura };
}

describe('Ficha do titular — leituras da conta (doc 02 §33)', () => {
  // Terça, 17/11/2026, meio-dia no Brasil.
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-17T15:00:00Z')));
  afterAll(() => jest.useRealTimers());

  describe('faturas por visão', () => {
    it('"agora" traz as disponíveis e as vencidas, da mais antiga para a mais nova, sem paginar', async () => {
      const { service, db } = montar({ agora: [fatura('f36', 'FECHADA'), fatura('f37', 'FECHADA')] });
      const r = await service.faturasDaConta('c1', 'agora', 30, 5);
      const arg = db.fatura.findMany.mock.calls[0][0] as unknown as { where: Prisma.FaturaWhereInput; orderBy: unknown; skip: number };
      expect(arg.where).toMatchObject({ contaId: 'c1', OR: [{ status: 'FECHADA' }, { status: 'ABERTA', dataVencimento: { lt: dia('2026-11-17') } }] });
      expect(arg.orderBy).toEqual([{ dataVencimento: 'asc' }, { numero: 'asc' }]);
      expect(arg.skip).toBe(0);
      expect(r).toMatchObject({ visao: 'agora', total: 2, offset: 0 });
    });

    it('"pagas" vem da mais recente para a mais antiga, em blocos com offset', async () => {
      const { service, db } = montar();
      await service.faturasDaConta('c1', 'pagas', 10, 10);
      expect(db.fatura.findMany.mock.calls[0][0]).toMatchObject({
        where: { contaId: 'c1', status: { in: ['PAGA', 'PAGA_EM_ATRASO'] } },
        orderBy: [{ dataVencimento: 'desc' }, { numero: 'desc' }],
        skip: 10,
        take: 10,
      });
    });

    it('"a vencer" são as ainda não disponíveis, de hoje em diante', async () => {
      const { service, db } = montar();
      await service.faturasDaConta('c1', 'vencer');
      const arg = db.fatura.findMany.mock.calls[0][0] as unknown as { where: unknown };
      expect(arg.where).toEqual({ contaId: 'c1', status: 'ABERTA', dataVencimento: { gte: dia('2026-11-17') } });
    });

    it('falta hoje: Pix sob demanda usa o total do motor; modelo antigo vencido, o saldo com multa e atualização de hoje; paga não tem', async () => {
      const { service, contaFatura } = montar({
        agora: [fatura('f36', 'FECHADA', { modeloEncargo: 'AZIT', valorPago: 540 }), fatura('f37', 'FECHADA', { valorPago: 100 })],
        pagas: [fatura('f35', 'PAGA', { valorPago: 849 })],
        motor: { f36: { totalHoje: 32737, multa: 0, atualizacao: 54 } },
      });
      const agora = await service.faturasDaConta('c1', 'agora');
      expect(agora.data.map((f) => [f.faltaHoje, f.encargoHoje])).toEqual([
        [32737, 54],
        // modelo antigo, vencida há 15 dias, saldo 749,00: multa 2% (14,98) + atualização 1% a.m. por 15 dias (3,75)
        [74900 + 1498 + 375, 1498 + 375],
      ]);
      const pagas = await service.faturasDaConta('c1', 'pagas');
      expect(pagas.data[0].faltaHoje).toBeNull();
      expect(contaFatura.carregar).toHaveBeenCalledTimes(1); // só a visão com fatura AZIT fechada lê a conta
    });
  });

  describe('posição de hoje', () => {
    it('soma o que está vencido, conta os dias da mais antiga e aponta a próxima disponível', async () => {
      const { service } = montar({
        agora: [
          fatura('f36', 'FECHADA', { venc: '2026-11-09', modeloEncargo: 'AZIT', valorPago: 540, token: 'a'.repeat(64) }),
          fatura('f37', 'FECHADA', { venc: '2026-11-16' }),
          fatura('f38', 'FECHADA', { venc: '2026-11-23', modeloEncargo: 'AZIT' }),
        ],
        vencer: [fatura('f39', 'ABERTA', { venc: '2026-11-30' }), fatura('f40', 'ABERTA', { venc: '2026-12-07' })],
        pagas: [fatura('f35', 'PAGA', { valorPago: 849 })],
        motor: { f36: { totalHoje: 32737, multa: 0, atualizacao: 54 }, f38: { totalHoje: 84900, multa: 0, atualizacao: 0 } },
      });
      const r = await service.posicaoDaConta('c1');
      expect(r.hoje).toBe('2026-11-17');
      // f37 (modelo antigo, vencida há 1 dia): 849,00 + multa 16,98 + atualização 0,28 = 866,26
      expect(r.atraso).toEqual({ faturas: 2, valorHoje: 32737 + 86626, encargos: 54 + 1726, diasMaisAntiga: 8 });
      expect(r.proxima).toMatchObject({ numero: 38, valor: 84900, disponivel: true });
      expect(r.faturaComLinkId).toBe('f36');
      expect(r.trilho).toEqual({ pagas: 1, emAtraso: 2, valorEmAtraso: 119363, aVencer: 2, valorAVencer: 169800 });
      expect(r.contagem).toEqual({ agora: 3, vencer: 2, pagas: 1, outras: 0 });
    });

    it('em dia e sem fatura disponível: a próxima é a primeira ainda não emitida', async () => {
      const { service } = montar({ vencer: [fatura('f39', 'ABERTA', { venc: '2026-11-30' })] });
      const r = await service.posicaoDaConta('c1');
      expect(r.atraso).toMatchObject({ faturas: 0, valorHoje: 0, diasMaisAntiga: 0 });
      expect(r.proxima).toMatchObject({ numero: 39, valor: 84900, disponivel: false });
      expect(r.ultimoPagamento).toBeNull();
    });
  });

  describe('pagamentos da conta', () => {
    const pag = (
      id: string,
      faturaId: string,
      numero: number,
      valor: number,
      o: Partial<{ gateway: string; dia: string; status: string; encargo: number; excedente: number; origem: string }> = {},
    ) => ({
      id,
      faturaId,
      valor: dec(valor),
      valorExcedente: dec(o.excedente ?? 0),
      dataPagamento: dia(o.dia ?? '2026-10-05'),
      pagoEm: new Date(`${o.dia ?? '2026-10-05'}T14:30:00Z`),
      createdAt: new Date(`${o.dia ?? '2026-10-05'}T14:30:05Z`),
      origem: o.origem ?? 'GATEWAY',
      gatewayPaymentId: o.gateway ?? null,
      fatura: { id: faturaId, numero, status: o.status ?? 'PAGA' },
      alocacoes: o.encargo
        ? [
            { tipoEncargo: 'MULTA', valor: dec(o.encargo) },
            { tipoEncargo: null, valor: dec(valor - o.encargo) },
          ]
        : [{ tipoEncargo: null, valor: dec(valor) }],
    });

    it('um Pix que cobre duas faturas aparece uma vez, com os dois destinos', async () => {
      const { service } = montar({
        pagamentos: [
          pag('p1', 'f31', 31, 849, { gateway: 'pay_900' }),
          pag('p2', 'f32', 32, 51, { gateway: 'pay_900' }),
          pag('p3', 'f32', 32, 798, { gateway: 'pay_798', dia: '2026-10-13' }),
        ],
      });
      const r = await service.pagamentosDaConta('c1');
      expect(r.total).toBe(2);
      expect(r.data[0]).toMatchObject({ dia: '2026-10-13', tipo: 'pix', valor: 79800, destinos: [{ numero: 32, valor: 79800, quitou: true }] });
      expect(r.data[1]).toMatchObject({
        dia: '2026-10-05',
        hora: '11:30',
        valor: 90000,
        destinos: [
          { numero: 31, valor: 84900, quitou: true },
          { numero: 32, valor: 5100, quitou: false }, // em parte: quem quitou a 32 foi o Pix de 13/10
        ],
      });
    });

    it('separa multa e atualização dentro do pagamento e guarda o excedente', async () => {
      const { service } = montar({ pagamentos: [pag('p1', 'f33', 33, 866.26, { encargo: 17.26, excedente: 3.74 })] });
      const [p] = (await service.pagamentosDaConta('c1')).data;
      expect(p).toMatchObject({ valor: 87000, excedente: 374, destinos: [{ numero: 33, valor: 86626, encargos: 1726 }] });
    });

    it('junta cobrança do Asaas e entradas na mesma linha do tempo, da mais recente para a mais antiga', async () => {
      const { service } = montar({
        pagamentos: [pag('p1', 'f36', 36, 540, { dia: '2026-11-12', status: 'FECHADA' })],
        semRegistro: [
          { id: 'f20', numero: 20, status: 'PAGA_EM_ATRASO', valorPago: dec(866.26), dataPagamento: new Date('2026-07-21T13:00:00Z'), parcelas: [{ valorEncargo: dec(17.26) }] },
        ],
        lancamentos: [
          { id: 'l1', tipo: 'ENTRADA_CONTRATO', descricao: 'Entrada do contrato 2026030014', valor: dec(6000), dataPagamento: dia('2026-03-02'), acordoId: null, contrato: { numero: '2026030014' } },
        ],
      });
      const r = await service.pagamentosDaConta('c1');
      expect(r.data.map((p) => [p.dia, p.tipo, p.valor])).toEqual([
        ['2026-11-12', 'pix', 54000],
        ['2026-07-21', 'cobranca', 86626],
        ['2026-03-02', 'entrada_contrato', 600000],
      ]);
      expect(r.data[0].destinos[0].quitou).toBe(false);
      expect(r.data[1].destinos[0]).toMatchObject({ numero: 20, encargos: 1726, quitou: true });
      expect(r.data[2]).toMatchObject({ contratoNumero: '2026030014', destinos: [] });
    });

    it('pagina pelo offset', async () => {
      const { service } = montar({ pagamentos: [1, 2, 3].map((n) => pag(`p${n}`, `f${n}`, n, 849, { dia: `2026-10-0${n}` })) });
      const r = await service.pagamentosDaConta('c1', 1, 1);
      expect(r).toMatchObject({ total: 3, offset: 1 });
      expect(r.data.map((p) => p.destinos[0].numero)).toEqual([2]);
    });
  });
});
