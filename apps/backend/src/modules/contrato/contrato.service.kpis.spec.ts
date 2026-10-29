import { ContratoService } from './contrato.service';

// KPIs da Carteira por CONTA e por TIPO (decisão Luís 29/10/2026, doc 02 §5.2).
// Cenário espelha produção: cliente com veículo + Reembolso Parcelado conta UMA
// vez na inadimplência; "contratos ativos" são só os de veículo; carteira em
// três fatias; recebido na semana = segunda → hoje no fuso do Brasil. Sem banco.

// Quinta-feira 29/10/2026, 12:00 em Brasília (15:00Z) → semana começa seg 26/10.
const AGORA = new Date('2026-10-29T15:00:00.000Z');

const ativos = [
  { id: 'c1', numero: '202510001', contaId: 'A', snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null },
  { id: 'c2', numero: '202510001-RP1', contaId: 'A', snapshotJson: { legado: { reembolsoDe: '202510001', rotulo: 'IPVA' } }, ativo: null, novacaoComoTermo: null },
  { id: 'c3', numero: '202510002', contaId: 'B', snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null },
  { id: 'c4', numero: '202510003', contaId: 'C', snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null },
  { id: 'c5', numero: '202510004', contaId: 'B', snapshotJson: { documento: 'termo' }, ativo: null, novacaoComoTermo: null }, // RP nativo (aprovação)
  { id: 'c6', numero: '202510005', contaId: 'D', snapshotJson: null, ativo: null, novacaoComoTermo: { id: 'nv1' } }, // Termo de novação
];

function montar() {
  const parcelaGroupBy = jest.fn().mockImplementation(async (args: { where: { itemContratado: { origem: string } } }) =>
    args.where.itemContratado.origem === 'ACORDO'
      ? [{ contratoId: 'c1', _sum: { valorNominal: '700.00' } }]
      : [
          { contratoId: 'c1', _sum: { valorNominal: '5000.00' } },
          { contratoId: 'c2', _sum: { valorNominal: '300.00' } },
          { contratoId: 'c3', _sum: { valorNominal: '4000.00' } },
          { contratoId: 'c5', _sum: { valorNominal: '200.00' } },
          { contratoId: 'c6', _sum: { valorNominal: '900.00' } },
        ],
  );
  const parcelaFindMany = jest.fn().mockResolvedValue([
    { dataPagamento: new Date('2026-10-26T00:00:00.000Z'), valorPago: '997.00', valorEncargo: null }, // seg, dia-calendário (cronograma)
    { dataPagamento: new Date('2026-10-26T02:30:00.000Z'), valorPago: '997.00', valorEncargo: '0.00' }, // dom 25/10 23:30 BRT — fora da semana, dentro dos 7 dias
    { dataPagamento: new Date('2026-10-28T03:00:00.000Z'), valorPago: '1019.62', valorEncargo: '22.62' }, // qua, 03:00Z (legado)
    { dataPagamento: new Date('2026-10-22T00:00:00.000Z'), valorPago: '997.00', valorEncargo: null }, // fora das duas janelas
    { dataPagamento: null, valorPago: '100.00', valorEncargo: null }, // parcial sem data — ignorada
  ]);
  const lancamentoFindMany = jest.fn().mockResolvedValue([
    { dataPagamento: new Date('2026-10-27T18:00:00.000Z'), valor: '3000.00' }, // ter 15:00 BRT (entrada paga via webhook)
    { dataPagamento: new Date('2026-10-24T00:00:00.000Z'), valor: '500.00' }, // sáb — só nos 7 dias
  ]);
  const prisma = {
    db: {
      contratoCredito: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'ATIVO', _count: { _all: 6 } },
          { status: 'ENCERRADO', _count: { _all: 2 } },
        ]),
        findMany: jest.fn().mockResolvedValue(ativos),
      },
      fatura: {
        findMany: jest.fn().mockResolvedValue([
          { contaId: 'A', valorTotal: '1000.00', valorPago: null },
          { contaId: 'A', valorTotal: '500.00', valorPago: '100.00' }, // parcial: falta 400
          { contaId: 'D', valorTotal: '200.00', valorPago: null }, // conta sem veículo vigente
        ]),
      },
      parcela: { groupBy: parcelaGroupBy, findMany: parcelaFindMany },
      lancamentoConta: { findMany: lancamentoFindMany },
      aprovacao: { findMany: jest.fn().mockResolvedValue([{ referenciaId: 'c5' }]) },
    },
  };
  const service = new ContratoService(prisma as never);
  return { service, prisma, parcelaGroupBy, parcelaFindMany, lancamentoFindMany };
}

describe('ContratoService.kpis — por conta e por tipo (29/10/2026)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: AGORA });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('contratos ativos = só veículo; RP (legado e nativo) e Termo ficam no secundário', async () => {
    const { service, prisma } = montar();
    const k = await service.kpis();
    expect(k.contratosAtivos).toBe(3);
    expect(k.contratosAtivosTotal).toBe(6);
    expect(k.contratosAtivosPorTipo).toEqual({ veiculo: 3, reembolso: 2, credito: 0, termo_novacao: 1 });
    expect(k.totalContratos).toBe(8);
    // A marca do RP nativo é a aprovação — consultada só para os contratos sem ativo.
    expect(prisma.db.aprovacao.findMany).toHaveBeenCalledWith({
      where: { referenciaTipo: 'contrato_credito', tipoOperacao: 'reembolso_parcelado', referenciaId: { in: ['c2', 'c5', 'c6'] } },
      select: { referenciaId: true },
    });
  });

  it('inadimplência por CONTA: cliente com veículo + RP conta uma vez; base = contas com veículo vigente', async () => {
    const { service } = montar();
    const k = await service.kpis();
    expect(k.inadimplencia).toEqual({
      contasBase: 3, // A, B, C (D só tem o Termo)
      contasInadimplentes: 1, // A — duas faturas vencidas, uma conta
      contasEmAtrasoForaDaBase: 1, // D
      pct: 33.3,
      valorEmAtraso: 160_000, // 1000 + (500 − 100) + 200
      faturasVencidas: 3,
    });
    expect(k.inadimplentes).toBe(1);
    expect(k.inadimplenciaPct).toBe(33.3);
  });

  it('carteira sob gestão em três fatias: veículo, acordos (cotas + Termo) e reembolsos', async () => {
    const { service, parcelaGroupBy } = montar();
    const k = await service.kpis();
    expect(k.carteira).toEqual({ veiculo: 900_000, acordos: 160_000, reembolsos: 50_000, total: 1_110_000 });
    expect(k.carteiraSobGestao).toBe(1_110_000);
    // Só contratos vigentes, só parcelas em aberto fora de acordo.
    for (const chamada of parcelaGroupBy.mock.calls) {
      expect(chamada[0].where).toMatchObject({ contratoId: { in: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }, status: null, acordoId: null });
    }
  });

  it('recebido na semana = segunda 26/10 → hoje, no fuso do Brasil, separado em parcelas/encargos/entradas', async () => {
    const { service, parcelaFindMany, lancamentoFindMany } = montar();
    const k = await service.kpis();
    expect(k.recebido.semana).toEqual({
      desde: '2026-10-26',
      ate: '2026-10-29',
      parcelas: 199_400, // 997,00 + (1019,62 − 22,62)
      encargos: 2_262,
      entradas: 300_000,
      total: 501_662,
    });
    expect(k.recebidoNaSemana).toBe(501_662);
    // Linha secundária: últimos 7 dias (23/10 → 29/10) inclui o domingo e o sábado.
    expect(k.recebido.ultimos7Dias).toEqual({
      desde: '2026-10-23',
      ate: '2026-10-29',
      parcelas: 299_100,
      encargos: 2_262,
      entradas: 350_000,
      total: 651_362,
    });
    // A busca parte do início mais antigo (7 dias), nunca de Date.now() − 7×24h.
    const inicio = new Date('2026-10-23T00:00:00.000Z');
    expect(parcelaFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dataPagamento: { gte: inicio } }) }));
    expect(lancamentoFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { dataPagamento: { gte: inicio } } }));
  });

  it('sem contrato vigente: zeros, sem consulta de parcelas em aberto', async () => {
    const { service, prisma, parcelaGroupBy } = montar();
    prisma.db.contratoCredito.findMany.mockResolvedValue([]);
    prisma.db.fatura.findMany.mockResolvedValue([]);
    const k = await service.kpis();
    expect(k.contratosAtivos).toBe(0);
    expect(k.inadimplencia.pct).toBe(0);
    expect(k.carteira.total).toBe(0);
    expect(parcelaGroupBy).not.toHaveBeenCalled();
  });
});
