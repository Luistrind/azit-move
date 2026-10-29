import { ContaService } from './conta.service';

// Posição por titular da Carteira (decisão Luís 29/10/2026, doc 02 §5.2): a
// coluna Contratos conta só os de VEÍCULO e marca os reembolsos em andamento;
// "Em atraso" e "Faturas vencidas" vêm das FATURAS da conta — a mesma régua da
// inadimplência dos cartões. Sem banco.

const AGORA = new Date('2026-10-29T15:00:00.000Z');

const contas = [
  {
    id: 'A',
    titular: { id: 't-a', nome: 'Ana', cpfCnpj: '111' },
    contratosCredito: [
      { id: 'c1', numero: '202510001', snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null, status: 'ATIVO', veiculoBloqueadoEm: null },
      { id: 'c2', numero: '202510001-RP1', snapshotJson: { legado: { reembolsoDe: '202510001' } }, ativo: null, novacaoComoTermo: null, status: 'ATIVO', veiculoBloqueadoEm: null },
      { id: 'c0', numero: '202409001', snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null, status: 'ENCERRADO', veiculoBloqueadoEm: null },
    ],
    acordos: [],
  },
  {
    id: 'B',
    titular: { id: 't-b', nome: 'Bruno', cpfCnpj: '222' },
    contratosCredito: [
      { id: 'c3', numero: '202510002', snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null, status: 'ATIVO', veiculoBloqueadoEm: null },
    ],
    acordos: [{ id: 'ac1' }],
  },
  {
    id: 'C',
    titular: { id: 't-c', nome: 'Carla', cpfCnpj: '333' },
    contratosCredito: [
      { id: 'c4', numero: '202510003', snapshotJson: null, ativo: { tipo: 'VEICULO' }, novacaoComoTermo: null, status: 'ATIVO', veiculoBloqueadoEm: new Date('2026-10-20T12:00:00.000Z') },
    ],
    acordos: [],
  },
  { id: 'D', titular: { id: 't-d', nome: 'Sem contrato', cpfCnpj: '444' }, contratosCredito: [], acordos: [] },
];

function montar() {
  const prisma = {
    db: {
      conta: { findMany: jest.fn().mockResolvedValue(contas) },
      parcela: {
        groupBy: jest.fn().mockResolvedValue([
          { contratoId: 'c1', _sum: { valorNominal: '5000.00' } },
          { contratoId: 'c2', _sum: { valorNominal: '300.00' } },
          { contratoId: 'c3', _sum: { valorNominal: '4000.00' } },
          { contratoId: 'c4', _sum: { valorNominal: '2500.00' } },
        ]),
      },
      fatura: {
        findMany: jest.fn().mockResolvedValue([
          { contaId: 'A', valorTotal: '1112.63', valorPago: null }, // veículo + cota do RP na MESMA fatura
          { contaId: 'A', valorTotal: '997.00', valorPago: '200.00' }, // parcial
          { contaId: 'C', valorTotal: '997.00', valorPago: null },
        ]),
      },
      aprovacao: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const service = new ContaService(prisma as never);
  return { service, prisma };
}

describe('ContaService.carteira — posição por titular na régua das faturas (29/10/2026)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: AGORA });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('Contratos = só veículo, com o reembolso em andamento marcado à parte; atraso vem das faturas', async () => {
    const { service, prisma } = montar();
    const lista = await service.carteira();
    const ana = lista.find((c) => c.contaId === 'A')!;
    expect(ana).toMatchObject({
      contratosAtivos: 1,
      reembolsosAtivos: 1,
      contratosPorTipo: { veiculo: 1, reembolso: 1, credito: 0, termo_novacao: 0 },
      contratosTotal: 3,
      saldoDevedor: 530_000, // 5000 + 300 (vigentes; o encerrado não entra)
      valorEmAtraso: 190_963, // 1112,63 + (997,00 − 200,00)
      faturasVencidas: 2,
      bloqueada: false,
      situacao: 'em_atraso',
    });
    // Fatura vencida em aberto = ABERTA/FECHADA antes de hoje (29/10, fuso do Brasil).
    expect(prisma.db.fatura.findMany).toHaveBeenCalledWith({
      where: { contaId: { in: ['A', 'B', 'C', 'D'] }, dataVencimento: { lt: new Date('2026-10-29T00:00:00.000Z') }, status: { in: ['ABERTA', 'FECHADA'] } },
      select: { contaId: true, valorTotal: true, valorPago: true },
    });
  });

  it('acordo ATIVO sem fatura vencida em aberto = em acordo (as cobertas viram RENEGOCIADA e saem da régua)', async () => {
    const { service } = montar();
    const lista = await service.carteira();
    const bruno = lista.find((c) => c.contaId === 'B')!;
    expect(bruno).toMatchObject({ contratosAtivos: 1, reembolsosAtivos: 0, valorEmAtraso: 0, faturasVencidas: 0, situacao: 'em_acordo' });
  });

  it('bloqueio prevalece sobre o atraso; conta sem contrato não aparece', async () => {
    const { service } = montar();
    const lista = await service.carteira();
    expect(lista.find((c) => c.contaId === 'C')).toMatchObject({ bloqueada: true, situacao: 'bloqueada', faturasVencidas: 1 });
    expect(lista.map((c) => c.contaId)).toEqual(['A', 'B', 'C']);
  });
});
