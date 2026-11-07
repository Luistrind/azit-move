import { Prisma } from '@prisma/client';
import { RescisaoService } from './rescisao.service';

// Rescisão por inadimplência (doc 02 §29, decisões Luís 04/11/2026). Sem banco:
// a conta é de @azit/utils (testada lá); aqui conferimos os fatos que o service
// carrega, as validações e os efeitos da efetivação.
const dec = (reais: number) => new Prisma.Decimal(reais.toFixed(2));

const contrato = {
  id: 'c1', numero: '2026090001', status: 'ATIVO', ativoId: 'a1', contaId: 'conta1',
  valorEntradaPago: dec(5000), taxaMultaAtraso: dec(2), taxaJurosAtraso: dec(1), recuperacaoIniciadaEm: null, veiculoBloqueadoEm: null,
  conta: { titularId: 't1', titular: { nome: 'Fulano' } },
  ativo: { descricao: 'HB20S 2024', placa: 'ABC1D23', modelo: 'HB20S' },
};
const pagas = [
  { display: '1/100', valorNominal: dec(997), valorPago: dec(997), valorEncargo: null, itensFatura: [{ tipo: 'PRINCIPAL', valor: dec(947) }, { tipo: 'SERVICO', valor: dec(50) }] },
  { display: '2/100', valorNominal: dec(997), valorPago: dec(1017.27), valorEncargo: dec(20.27), itensFatura: [{ tipo: 'PRINCIPAL', valor: dec(947) }, { tipo: 'SERVICO', valor: dec(50) }] },
];
const abertas = [
  { id: 'p3', display: '3/100', valorNominal: dec(997), dataVencimento: new Date('2026-10-05T00:00:00.000Z') },
  { id: 'p4', display: '4/100', valorNominal: dec(997), dataVencimento: new Date('2026-10-12T00:00:00.000Z') },
  { id: 'p5', display: '5/100', valorNominal: dec(997), dataVencimento: new Date('2026-11-16T00:00:00.000Z') },
];

function montar(over: Partial<typeof contrato> = {}) {
  const tx = {
    recebivel: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    parcela: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    itemContratado: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    fatura: {
      findMany: jest.fn().mockResolvedValue([
        // só deste contrato, com cobrança → RESCINDIDA e cobrança removida
        { id: 'f3', numero: 3, status: 'FECHADA', asaasChargeId: 'pay_3', itensFatura: [{ id: 'i3', valor: dec(997), parcelaId: 'p3', parcela: { contratoId: 'c1' } }] },
        // mista (outro contrato na mesma conta), com cobrança → item sai, volta a ABERTA
        { id: 'f5', numero: 5, status: 'FECHADA', asaasChargeId: 'pay_5', itensFatura: [
          { id: 'i5', valor: dec(997), parcelaId: 'p5', parcela: { contratoId: 'c1' } },
          { id: 'i5b', valor: dec(212.38), parcelaId: 'px', parcela: { contratoId: 'c2' } },
        ] },
        // de outro contrato: intocada
        { id: 'f9', numero: 9, status: 'ABERTA', asaasChargeId: null, itensFatura: [{ id: 'i9', valor: dec(100), parcelaId: 'py', parcela: { contratoId: 'c2' } }] },
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    itemFatura: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contratoCredito: { count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue({}) },
    acordo: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    ativo: { update: jest.fn().mockResolvedValue({}) },
    rescisaoContrato: { update: jest.fn().mockResolvedValue({}) },
    logAuditoria: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    db: {
      contratoCredito: { findFirst: jest.fn().mockResolvedValue({ ...contrato, ...over }) },
      parcela: {
        findMany: jest.fn().mockImplementation(async (args: { where: { status: unknown } }) => (args.where.status === null ? abertas : pagas)),
      },
      rescisaoContrato: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aprovacao: { findFirst: jest.fn().mockResolvedValue(null) },
      logAuditoria: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    },
  };
  const aprovacao = { registrarEfetivador: jest.fn(), criar: jest.fn().mockResolvedValue({ id: 'ap1', status: 'pendente' }) };
  const asaas = { removerCobranca: jest.fn().mockResolvedValue(true) };
  const service = new RescisaoService(prisma as never, aprovacao as never, asaas as never);
  return { service, prisma, tx, aprovacao, asaas };
}

describe('RescisaoService', () => {
  it('prévia: base = entrada + principal das parcelas pagas (sem proteção, sem encargo); vencidas até a data-base', async () => {
    const { service } = montar();
    const p = await service.previa('c1', '2026-11-04');
    expect(p.elegivel).toBe(true);
    expect(p.acerto.entradaPaga).toBe(500_000);
    // 1/100: 997 − 50 = 947; 2/100: (1017,27 − 20,27) − 50 = 947
    expect(p.acerto.principalParcelas).toBe(94_700 * 2);
    expect(p.acerto.valorCredito).toBe(Math.round((500_000 + 189_400) * 0.2));
    expect(p.acerto.vencidas.map((v) => v.id)).toEqual(['p3', 'p4']);
    expect(p.acerto.futuras.quantidade).toBe(1);
    // crédito 137.880 < dívida (2 × 997 + encargos): fica saldo remanescente, nada a devolver
    expect(p.acerto.saldoRemanescente).toBe(p.acerto.dividaTotal - p.acerto.valorCredito);
    expect(p.acerto.valorADevolver).toBe(0);
  });

  it('prévia: contrato sem parcela vencida até a data-base não é elegível; data futura é recusada', async () => {
    const { service } = montar();
    const p = await service.previa('c1', '2026-10-01');
    expect(p.elegivel).toBe(false);
    expect(p.motivoInelegivel).toMatch(/vencida/);
    await expect(service.previa('c1', '2099-01-01')).rejects.toMatchObject({ response: { erro: 'data_futura' } });
  });

  it('solicitar: grava o snapshot PENDENTE e abre a aprovação tipo rescisao com o contrato como referência', async () => {
    const { service, prisma, aprovacao } = montar();
    const r = await service.solicitar('c1', { dataBase: '2026-11-04', observacao: 'Veículo retomado no pátio' }, 'u-op');
    expect(r.status).toBe('pendente');
    expect(prisma.db.rescisaoContrato.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contratoId: 'c1', solicitanteId: 'u-op', observacao: 'Veículo retomado no pátio', percentualCredito: '20.00' }),
    });
    expect(aprovacao.criar).toHaveBeenCalledWith(expect.objectContaining({
      tipoOperacao: 'rescisao', referenciaTipo: 'rescisao', referenciaId: 'c1', titularId: 't1', solicitanteId: 'u-op',
      valorCentavos: 99_700 * 3, // saldo em aberto do contrato
    }));
  });

  it('solicitar: recusa contrato que não está em vida', async () => {
    const { service } = montar({ status: 'ENCERRADO' });
    await expect(service.solicitar('c1', { dataBase: '2026-11-04' }, 'u-op')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
  });

  it('efetivar: encerra por RESCISAO na data-base, rescinde parcelas, trata faturas só/mistas, recupera o ativo e remove cobranças', async () => {
    const { service, prisma, tx, asaas } = montar();
    prisma.db.rescisaoContrato.findFirst.mockResolvedValue({ id: 'r1', contratoId: 'c1', status: 'PENDENTE', dataBase: new Date('2026-11-04T00:00:00.000Z') });

    const r = await service.efetivar('c1', 'u-aprov');

    expect(r?.numero).toBe('2026090001');
    expect(tx.parcela.updateMany).toHaveBeenCalledWith({ where: { contratoId: 'c1', status: null }, data: { status: 'RESCINDIDA' } });
    expect(tx.recebivel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELADO' } }));
    expect(tx.itemContratado.updateMany).toHaveBeenCalledWith({ where: { contratoId: 'c1', status: 'ATIVO' }, data: { status: 'ENCERRADO' } });
    // f3 só deste contrato → RESCINDIDA
    expect(tx.fatura.update).toHaveBeenCalledWith({ where: { id: 'f3' }, data: { status: 'RESCINDIDA' } });
    // f5 mista → item deste contrato sai, total recalculado, cobrança sai e volta a ABERTA
    expect(tx.itemFatura.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['i5'] } } });
    expect(tx.fatura.update).toHaveBeenCalledWith({ where: { id: 'f5' }, data: { valorTotal: '212.38', asaasChargeId: null, status: 'ABERTA' } });
    // f9 de outro contrato: intocada
    expect(tx.fatura.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'f9' } }));
    expect(tx.contratoCredito.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENCERRADO', motivoEncerramento: 'RESCISAO', dataEncerramento: new Date('2026-11-04T00:00:00.000Z'), recuperacaoIniciadaEm: new Date('2026-11-04T00:00:00.000Z') },
    });
    expect(tx.ativo.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'RECUPERADO' } });
    expect(tx.rescisaoContrato.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'EFETIVADA', aprovadaPor: 'u-aprov' }) });
    expect(asaas.removerCobranca.mock.calls.map((c) => c[0]).sort()).toEqual(['pay_3', 'pay_5']);
    expect(r?.avisos.join(' ')).toMatch(/Fatura #5 é de mais de um contrato/);
  });

  it('efetivar sem rescisão pendente não faz nada', async () => {
    const { service, tx } = montar();
    expect(await service.efetivar('c1', 'u-aprov')).toBeNull();
    expect(tx.contratoCredito.update).not.toHaveBeenCalled();
  });
});
