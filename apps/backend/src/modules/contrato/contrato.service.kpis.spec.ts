import { ContratoService } from './contrato.service';

// KPIs da Carteira por CONTA e por TIPO (decisão Luís 29/10/2026, doc 02 §5.2).
// Cenário espelha produção: cliente com veículo + Reembolso Parcelado conta UMA
// vez na inadimplência; "contratos ativos" são só os de veículo; carteira em
// três fatias; recebido na semana mantém a janela (últimos 7 dias corridos) e
// só abre a composição. Sem banco.

// Quinta-feira 29/10/2026, 12:00 em Brasília (15:00Z).
const AGORA = new Date('2026-10-29T15:00:00.000Z');
const DIA_MS = 86_400_000;

const veiculo = (id: string, numero: string) => ({ id, numero, snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null });

const ativos = [
  { ...veiculo('c1', '202510001'), contaId: 'A' },
  { id: 'c2', numero: '202510001-RP1', contaId: 'A', snapshotJson: { legado: { reembolsoDe: '202510001', rotulo: 'IPVA' } }, ativo: null, novacaoComoTermo: null },
  { ...veiculo('c3', '202510002'), contaId: 'B' },
  { ...veiculo('c4', '202510003'), contaId: 'C' },
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
    { valorPago: '997.00', valorEncargo: null, itemContratado: { origem: 'VENDA' }, contrato: ativos[0] }, // parcela do veículo
    { valorPago: '250.00', valorEncargo: null, itemContratado: { origem: 'ACORDO' }, contrato: ativos[0] }, // cota de acordo no contrato do veículo
    { valorPago: '115.63', valorEncargo: '0.00', itemContratado: { origem: 'VENDA' }, contrato: ativos[1] }, // cota do RP
    { valorPago: '1019.62', valorEncargo: '22.62', itemContratado: { origem: 'VENDA' }, contrato: veiculo('c9', '202409009') }, // última parcela de contrato já ENCERRADO por quitação
  ]);
  const lancamentoAggregate = jest.fn().mockResolvedValue({ _sum: { valor: '3000.00' } });
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
      lancamentoConta: { aggregate: lancamentoAggregate },
      aprovacao: { findMany: jest.fn().mockResolvedValue([{ referenciaId: 'c5' }]) },
    },
  };
  const service = new ContratoService(prisma as never);
  return { service, prisma, parcelaGroupBy, parcelaFindMany, lancamentoAggregate };
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
    const { service, prisma } = montar();
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
    // Vencida = ABERTA/FECHADA antes de hoje no fuso do Brasil (29/10).
    expect(prisma.db.fatura.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['ABERTA', 'FECHADA'] }, dataVencimento: { lt: new Date('2026-10-29T00:00:00.000Z') } },
      select: { contaId: true, valorTotal: true, valorPago: true },
    });
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

  it('recebido na semana: mesma janela e mesmo total de antes (últimos 7 dias corridos), aberto em veículo/acordos/reembolsos/encargos/entradas', async () => {
    const { service, parcelaFindMany, lancamentoAggregate } = montar();
    const k = await service.kpis();
    expect(k.recebido).toEqual({
      veiculo: 199_400, // 997,00 + (1019,62 − 22,62) — inclui a parcela do contrato já encerrado
      acordos: 25_000,
      reembolsos: 11_563,
      encargos: 2_262,
      entradas: 300_000,
      total: 538_225, // = soma do valor pago (2.382,25) + lançamentos (3.000,00): o número de sempre
    });
    expect(k.recebidoNaSemana).toBe(538_225);
    // Janela mantida (correção Luís 29/10): agora − 7 dias corridos.
    const inicio = new Date(AGORA.getTime() - 7 * DIA_MS);
    expect(parcelaFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dataPagamento: { gte: inicio } }) }));
    expect(lancamentoAggregate).toHaveBeenCalledWith({ where: { dataPagamento: { gte: inicio } }, _sum: { valor: true } });
  });

  it('sem contrato vigente: zeros, sem consulta de parcelas em aberto', async () => {
    const { service, prisma, parcelaGroupBy, parcelaFindMany } = montar();
    prisma.db.contratoCredito.findMany.mockResolvedValue([]);
    prisma.db.fatura.findMany.mockResolvedValue([]);
    parcelaFindMany.mockResolvedValue([]);
    const k = await service.kpis();
    expect(k.contratosAtivos).toBe(0);
    expect(k.inadimplencia.pct).toBe(0);
    expect(k.carteira.total).toBe(0);
    expect(k.recebido.total).toBe(300_000); // só a entrada lançada
    expect(parcelaGroupBy).not.toHaveBeenCalled();
  });
});
