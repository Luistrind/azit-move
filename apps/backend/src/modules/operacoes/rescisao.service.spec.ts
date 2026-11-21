import { Prisma } from '@prisma/client';
import { RescisaoService } from './rescisao.service';
import { intencoesStub, semAzit } from './azit.fixture-spec';

// Rescisão (doc 02 §29, decisões Luís 04/11/2026; fluxo direto, custos e boleto
// do saldo §29.3, 20–21/11). Sem banco: a conta é de @azit/utils (testada lá);
// aqui conferimos os fatos que o service carrega, as validações e os efeitos.
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

// Custos da recuperação do contrato (só os do cliente chegam ao acerto) e multas do veículo.
const custoRetomada = { id: 'k1', tipo: 'retomada', descricao: 'Retirada do veículo', valor: dec(800), situacao: 'PAGO' };
const custoFunilaria = { id: 'k2', tipo: 'avaria', descricao: 'Para-choque', valor: dec(1650), situacao: 'ORCADO' };
const multa = { id: 'm1', tipo: 'MULTA', numeroAuto: 'AB123', dataFato: new Date('2026-11-02T15:00:00.000Z'), valor: dec(293.47), valorComDesconto: null };

function montar(over: Partial<typeof contrato> = {}, fatos: { custos?: unknown[]; multas?: unknown[]; multasFora?: number } = {}) {
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
    itemFatura: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    // Nenhum item recebeu pagamento (faturas do modelo antigo): tudo como antes.
    alocacaoPagamento: { groupBy: jest.fn().mockResolvedValue([]) },
    contratoCredito: { count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue({}) },
    acordo: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    ativo: { update: jest.fn().mockResolvedValue({}) },
    rescisaoContrato: { update: jest.fn().mockResolvedValue({}) },
    ocorrenciaVeiculo: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    lancamentoConta: { create: jest.fn().mockResolvedValue({}) },
    logAuditoria: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    db: {
      contratoCredito: { findFirst: jest.fn().mockResolvedValue({ ...contrato, ...over }), count: jest.fn().mockResolvedValue(0) },
      lancamentoCustoAtivo: { findMany: jest.fn().mockResolvedValue(fatos.custos ?? []) },
      ocorrenciaVeiculo: { findMany: jest.fn().mockResolvedValue(fatos.multas ?? []), count: jest.fn().mockResolvedValue(fatos.multasFora ?? 0) },
      fatura: { count: jest.fn().mockResolvedValue(2) },
      usuario: { findFirst: jest.fn().mockResolvedValue({ nome: 'Luís' }), findMany: jest.fn().mockResolvedValue([]) },
      titular: { update: jest.fn().mockResolvedValue({}) },
      parcela: {
        findMany: jest.fn().mockImplementation(async (args: { where: { status: unknown } }) => (args.where.status === null ? abertas : pagas)),
      },
      rescisaoContrato: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aprovacao: { findFirst: jest.fn().mockResolvedValue(null) },
      logAuditoria: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    },
  };
  const aprovacao = { registrarEfetivador: jest.fn(), criar: jest.fn().mockResolvedValue({ id: 'ap1', status: 'pendente' }) };
  const asaas = {
    removerCobranca: jest.fn().mockResolvedValue(true),
    clienteReutilizavel: jest.fn().mockReturnValue('cus_1'),
    criarCliente: jest.fn(),
    criarCobranca: jest.fn().mockResolvedValue({ id: 'pay_saldo', invoiceUrl: 'https://asaas/i/saldo' }),
  };
  const alertas = { emitir: jest.fn().mockResolvedValue(undefined) };
  const service = new RescisaoService(prisma as never, aprovacao as never, asaas as never, semAzit() as never, intencoesStub() as never, alertas as never);
  return { service, prisma, tx, aprovacao, asaas, alertas };
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

  it('prévia: sem parcela vencida até a data-base CONTINUA elegível (devolução de boa-fé, §29.3); data futura é recusada', async () => {
    const { service } = montar();
    const p = await service.previa('c1', '2026-10-01');
    expect(p.elegivel).toBe(true);
    expect(p.acerto.vencidas).toEqual([]);
    expect(p.acerto.valorADevolver).toBe(p.acerto.valorCredito);
    await expect(service.previa('c1', '2099-01-01')).rejects.toMatchObject({ response: { erro: 'data_futura' } });
  });

  it('prévia: custos do cliente (orçado incluso) e multa do veículo entram na dívida; a confirmação recebe as consequências', async () => {
    const { service, prisma } = montar({}, { custos: [custoRetomada, custoFunilaria], multas: [multa], multasFora: 1 });
    const p = await service.previa('c1', '2026-11-04');
    expect(prisma.db.lancamentoCustoAtivo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { contratoId: 'c1', deletedAt: null, quemPaga: 'CLIENTE' } }));
    expect(p.acerto.custosCliente).toBe(245_000);
    expect(p.acerto.custosOrcados).toBe(165_000);
    expect(p.acerto.multasVeiculo).toBe(29_347);
    expect(p.acerto.multas?.[0].descricao).toMatch(/Multa AB123 · fato em 02\/11\/2026/);
    expect(p.acerto.dividaTotal).toBe(p.acerto.dividaVencida + p.acerto.encargosVencidos + 245_000 + 29_347);
    expect(p.consequencias).toEqual({ cobrancasNoAr: 2, outrosContratosAtivos: 0, multasFora: 1 });
  });

  it('rescindir: efetiva NA HORA, sem passar pela Central — grava origem e marca quem rescindiu', async () => {
    const { service, prisma, tx, aprovacao } = montar({}, { custos: [custoRetomada], multas: [multa] });
    prisma.db.rescisaoContrato.findFirst
      .mockResolvedValueOnce(null) // nenhum pedido antigo pendente
      .mockResolvedValueOnce({ id: 'r1', contratoId: 'c1', status: 'PENDENTE', dataBase: new Date('2026-11-04T00:00:00.000Z') }); // o que acabou de criar
    const r = await service.rescindir('c1', { dataBase: '2026-11-04', origem: 'DEVOLUCAO', observacao: 'Cliente entregou o carro na loja' }, 'u-admin');
    expect(r.status).toBe('efetivada');
    expect(aprovacao.criar).not.toHaveBeenCalled();
    expect(prisma.db.rescisaoContrato.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contratoId: 'c1', solicitanteId: 'u-admin', origem: 'DEVOLUCAO', observacao: 'Cliente entregou o carro na loja', custosCliente: '800.00', multasVeiculo: '293.47' }),
    });
    expect(tx.contratoCredito.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ENCERRADO', motivoEncerramento: 'RESCISAO' }) }));
    expect(tx.rescisaoContrato.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'EFETIVADA', aprovadaPor: 'u-admin' }) });
    // a multa que entrou na dívida fica repassada pelo acerto — não vai mais para fatura
    expect(tx.ocorrenciaVeiculo.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] }, status: 'REGISTRADA' },
      data: expect.objectContaining({ status: 'REPASSADA', rescisaoId: 'r1', desfechoPor: 'u-admin' }),
    });
  });

  it('rescindir: recusa contrato fora de vida, e pedido antigo pendente na Central trava', async () => {
    await expect(montar({ status: 'ENCERRADO' }).service.rescindir('c1', { dataBase: '2026-11-04' }, 'u')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
    await expect(montar({ ativoId: null as never }).service.rescindir('c1', { dataBase: '2026-11-04' }, 'u')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
    const { service, prisma } = montar();
    prisma.db.rescisaoContrato.findFirst.mockResolvedValue({ id: 'velho' });
    await expect(service.rescindir('c1', { dataBase: '2026-11-04' }, 'u')).rejects.toMatchObject({ response: { erro: 'ja_pendente' } });
  });

  it('rescindir: se a efetivação falha, o registro não fica pendente travando a próxima tentativa', async () => {
    const { service, prisma } = montar();
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'r1', contratoId: 'c1', status: 'PENDENTE', dataBase: new Date('2026-11-04T00:00:00.000Z') });
    prisma.db.$transaction.mockRejectedValueOnce(new Error('banco fora'));
    await expect(service.rescindir('c1', { dataBase: '2026-11-04' }, 'u-admin')).rejects.toThrow('banco fora');
    expect(prisma.db.rescisaoContrato.updateMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'PENDENTE' }, data: { status: 'CANCELADA' } });
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

describe('RescisaoService — depois da rescisão (doc 02 §29.3)', () => {
  // Acerto gravado: crédito 1.000,00; vencidas 600,00 + encargo 20,00; custo orçado 300,00 → dívida 920 → a devolver 80.
  const acertoGravado = {
    dataBase: '2026-11-04', percentualCredito: 20, entradaPaga: 500_000, parcelasPagas: 0, principalParcelas: 0, principalParcial: 0, principalPago: 500_000,
    valorCredito: 100_000, vencidas: [], dividaVencida: 60_000, encargosVencidos: 2_000,
    custos: [{ id: 'k2', tipo: 'avaria', descricao: 'Para-choque', valor: 30_000, orcado: true }], custosCliente: 30_000, custosOrcados: 30_000,
    multas: [], multasVeiculo: 0, dividaTotal: 92_000, valorCompensado: 92_000, valorADevolver: 8_000, saldoRemanescente: 0, futuras: { quantidade: 0, valorNominal: 0 },
  };
  const efetivada = (over: Record<string, unknown> = {}) => ({
    id: 'r1', contratoId: 'c1', status: 'EFETIVADA', memoriaJson: { acerto: acertoGravado, avisos: [] }, ajustesJson: [],
    saldoRemanescente: dec(0), valorADevolver: dec(80), devolvidoEm: null, saldoPagoEm: null,
    cobrancaChargeId: null, cobrancaValor: null, ...over,
  });

  it('custo novo acima do crédito: o "a devolver" some, nasce saldo remanescente e o histórico registra o ajuste', async () => {
    const { service, prisma } = montar({}, { custos: [{ ...custoFunilaria, valor: dec(300) }, { id: 'k3', tipo: 'outro', descricao: 'Banco rasgado', valor: dec(620), situacao: 'ORCADO' }] });
    prisma.db.rescisaoContrato.findFirst.mockResolvedValue(efetivada());
    const r = await service.recalcularAposCusto('c1', 'u-op', 'Custo lançado: Outro R$ 620,00 (orçado)');
    expect(r?.mudou).toBe(true);
    expect(r?.acerto.dividaTotal).toBe(154_000);
    expect(r?.acerto.valorADevolver).toBe(0);
    expect(r?.acerto.saldoRemanescente).toBe(54_000);
    expect(prisma.db.rescisaoContrato.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: expect.objectContaining({
        saldoRemanescente: '540.00', valorADevolver: '0.00', custosCliente: '920.00',
        ajustesJson: [expect.objectContaining({ por: 'Luís', motivo: 'Custo lançado: Outro R$ 620,00 (orçado)', saldoAntes: 0, saldoDepois: 54_000, devolverAntes: 8_000, devolverDepois: 0 })],
      }),
    });
    expect(prisma.db.logAuditoria.create).toHaveBeenCalledWith({ data: expect.objectContaining({ acao: 'rescisao_acerto_ajustado', usuarioId: 'u-op' }) });
  });

  it('boleto do saldo no ar com valor antigo é trocado pelo valor novo', async () => {
    const { service, prisma, asaas } = montar({}, { custos: [{ ...custoFunilaria, valor: dec(1300) }] });
    prisma.db.rescisaoContrato.findFirst
      .mockResolvedValueOnce(efetivada({ cobrancaChargeId: 'pay_velho', cobrancaValor: dec(200), saldoRemanescente: dec(200) }))
      .mockResolvedValue({ id: 'r1', contratoId: 'c1', contrato: { numero: '2026090001', conta: { titular: { id: 't1', nome: 'Fulano', cpfCnpj: '1', email: null, whatsapp: null, asaasCustomerId: 'cus_1' } } } });
    await service.recalcularAposCusto('c1', 'u-op', 'Funilaria: de R$ 300,00 para R$ 1.300,00');
    expect(asaas.removerCobranca).toHaveBeenCalledWith('pay_velho');
    // dívida 600 + 20 + 1.300 = 1.920 − crédito 1.000 = 920,00
    expect(asaas.criarCobranca).toHaveBeenCalledWith(expect.objectContaining({ externalReference: 'rescisao:r1', valor: 92_000, formaPagamento: 'BOLETO' }));
  });

  it('acerto liquidado (devolução feita ou saldo pago) trava os custos do cliente', async () => {
    const { service, prisma } = montar();
    prisma.db.rescisaoContrato.findFirst.mockResolvedValue(efetivada({ devolvidoEm: new Date() }));
    expect(await service.motivoCustosTravados('c1')).toMatch(/devolução/);
    prisma.db.rescisaoContrato.findFirst.mockResolvedValue(efetivada({ saldoPagoEm: new Date() }));
    expect(await service.motivoCustosTravados('c1')).toMatch(/já foi pago/);
    prisma.db.rescisaoContrato.findFirst.mockResolvedValue(null); // contrato ainda ativo
    expect(await service.motivoCustosTravados('c1')).toBeNull();
  });

  it('gerar boleto do saldo: boleto (não Pix) com 15 dias ÚTEIS, referência rescisao:<id>', async () => {
    const { service, prisma, asaas } = montar();
    const titular = { id: 't1', nome: 'Fulano', cpfCnpj: '1', email: null, whatsapp: null, asaasCustomerId: 'cus_1' };
    prisma.db.rescisaoContrato.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'EFETIVADA', saldoPagoEm: null, saldoRemanescente: dec(540), cobrancaChargeId: null, cobrancaValor: null })
      .mockResolvedValueOnce({ id: 'r1', contratoId: 'c1', contrato: { numero: '2026090001', conta: { titular } } });
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T15:00:00.000Z')); // sexta
    try {
      const r = await service.gerarBoletoSaldo('r1', 'u-op');
      expect(r).toMatchObject({ resultado: 'boleto_emitido', valor: 54_000, vencimento: '2026-12-11', link: 'https://asaas/i/saldo' }); // 15 dias úteis depois de 20/11
      expect(asaas.criarCobranca).toHaveBeenCalledWith(expect.objectContaining({ externalReference: 'rescisao:r1', valor: 54_000, formaPagamento: 'BOLETO', customerId: 'cus_1' }));
      expect(prisma.db.rescisaoContrato.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ cobrancaChargeId: 'pay_saldo', cobrancaValor: '540.00', cobrancaLink: 'https://asaas/i/saldo' }) });
    } finally {
      jest.useRealTimers();
    }
  });

  it('gerar boleto: recusa sem saldo, já pago, ou com boleto no ar no mesmo valor', async () => {
    const { service, prisma } = montar();
    const base = { id: 'r1', status: 'EFETIVADA', saldoPagoEm: null, saldoRemanescente: dec(540), cobrancaChargeId: null, cobrancaValor: null };
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce({ ...base, saldoRemanescente: dec(0) });
    await expect(service.gerarBoletoSaldo('r1', 'u')).rejects.toMatchObject({ response: { erro: 'sem_saldo' } });
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce({ ...base, saldoPagoEm: new Date() });
    await expect(service.gerarBoletoSaldo('r1', 'u')).rejects.toMatchObject({ response: { erro: 'ja_pago' } });
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce({ ...base, cobrancaChargeId: 'pay_x', cobrancaValor: dec(540) });
    await expect(service.gerarBoletoSaldo('r1', 'u')).rejects.toMatchObject({ response: { erro: 'ja_emitido' } });
  });

  it('saldo pago (webhook): quita, entra no caixa da Carteira como lançamento da conta e é idempotente', async () => {
    const { service, prisma, tx, alertas } = montar();
    const r = { id: 'r1', contratoId: 'c1', saldoPagoEm: null, cobrancaChargeId: 'pay_saldo', cobrancaValor: dec(540), saldoRemanescente: dec(540), contrato: { numero: '2026090001', contaId: 'conta1', conta: { titular: { nome: 'Fulano' } } } };
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce(r);
    expect(await service.saldoRecebido('r1', '2026-12-01', { valorRecebido: 54_000, pagamentoId: 'pay_saldo' })).toEqual({ resultado: 'saldo_pago', valor: 54_000 });
    expect(tx.rescisaoContrato.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { saldoPagoEm: new Date('2026-12-01T00:00:00.000Z'), saldoValorPago: '540.00', cobrancaVencidaEm: null } });
    expect(tx.lancamentoConta.create).toHaveBeenCalledWith({ data: expect.objectContaining({ contaId: 'conta1', contratoId: 'c1', tipo: 'SALDO_RESCISAO', valor: '540.00', dataPagamento: new Date('2026-12-01T00:00:00.000Z') }) });
    expect(alertas.emitir).toHaveBeenCalledTimes(1);
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce({ ...r, saldoPagoEm: new Date() });
    expect(await service.saldoRecebido('r1', '2026-12-01', { valorRecebido: 54_000 })).toEqual({ resultado: 'ja_registrado' });
    expect(tx.lancamentoConta.create).toHaveBeenCalledTimes(1);
  });

  it('boleto vencido (webhook): avisa a carteira uma vez; aviso de boleto já substituído é ignorado', async () => {
    const { service, prisma, alertas } = montar();
    const r = { id: 'r1', contratoId: 'c1', saldoPagoEm: null, cobrancaChargeId: 'pay_saldo', cobrancaValor: dec(540), cobrancaVencidaEm: null, contrato: { numero: '2026090001', conta: { titular: { nome: 'Fulano' } } } };
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce(r);
    expect(await service.saldoVencido('r1', 'pay_antigo')).toEqual({ resultado: 'boleto_antigo' });
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce(r);
    expect(await service.saldoVencido('r1', 'pay_saldo')).toEqual({ resultado: 'vencido_avisado' });
    expect(alertas.emitir).toHaveBeenCalledWith(expect.objectContaining({ titulo: expect.stringMatching(/venceu/), corpo: expect.stringMatching(/negative este boleto no painel do Asaas/) }));
    prisma.db.rescisaoContrato.findFirst.mockResolvedValueOnce({ ...r, cobrancaVencidaEm: new Date() });
    expect(await service.saldoVencido('r1', 'pay_saldo')).toEqual({ resultado: 'ja_avisado' });
    expect(alertas.emitir).toHaveBeenCalledTimes(1);
  });
});
