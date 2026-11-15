import { aplicarPagamentoNaConta, reconstituirFatura } from '@azit/utils';
import { BaixaContaService } from './baixa-conta.service';
import { ContaFaturaService, type ContaCarregada } from './conta-fatura.service';
import type { JobBaixaIntencao } from './intencao-pagamento.service';
import { contaFixture, F2, F3, HOJE } from './conta.fixture-spec';

// Baixa PELA CONTA (doc 02 §32.4-A, §32.5, §32.6-A): o Pix de uma intenção é
// aplicado da fatura mais antiga para a mais nova, na data do pagamento, e
// grava PagamentoFatura + AlocacaoPagamento mantendo os efeitos da conciliação
// antiga (parcela, recebível, encerramento por quitação, status da fatura).
// Banco e gateway dublados; os números são os do roteiro do Vicente.

function montar(conta: ContaCarregada, opts: { situacaoIntencao?: string; jaAplicado?: boolean; parcelasAbertasDoContrato?: number; outrasAtivas?: { id: string; gatewayId: string | null }[]; intencaoExiste?: boolean } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    pagamentoFatura: { findFirst: jest.fn().mockResolvedValue(opts.jaAplicado ? { id: 'pg-existente' } : null), create: jest.fn().mockResolvedValue({}) },
    fatura: { update: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue({ id: 'f-ultima' }) },
    parcela: { update: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(opts.parcelasAbertasDoContrato ?? 5) },
    recebivel: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contratoCredito: { update: jest.fn().mockResolvedValue({}) },
    intencaoPagamento: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(opts.outrasAtivas ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const db = {
    intencaoPagamento: {
      findFirst: jest.fn().mockResolvedValue(
        opts.intencaoExiste === false ? null : { id: 'int_1', contaId: 'conta-1', situacao: opts.situacaoIntencao ?? 'ATIVA', conta: { titular: { id: 'tit-1', nome: 'Carlos Souza' } } },
      ),
    },
    acordo: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const contaFatura = new ContaFaturaService({ db } as never);
  const carregar = jest.spyOn(contaFatura, 'carregar').mockResolvedValue(conta);
  const notificacao = { emitir: jest.fn().mockResolvedValue(undefined) };
  const intencoes = { enfileirarCancelamento: jest.fn().mockResolvedValue(undefined) };
  const service = new BaixaContaService({ db } as never, contaFatura, notificacao as never, intencoes as never);
  return { service, tx, db, notificacao, intencoes, carregar };
}

const job = (valor: number, extra: Partial<JobBaixaIntencao> = {}): JobBaixaIntencao => ({
  intencaoId: 'int_1',
  pagamentoId: 'pay_123',
  valor,
  dataPagamento: HOJE,
  recebidoEm: '2026-11-09T15:03:00.000Z',
  identificadorPix: 'E182',
  origem: 'GATEWAY',
  ...extra,
});

type Criado = { data: { faturaId: string; valor: string; valorExcedente: string; gatewayPaymentId: string; intencaoId: string; origem: string; alocacoes?: { create: { itemFaturaId: string | null; tipoEncargo: string | null; valor: string; nivel: number; quitou: boolean }[] } } };
const criados = (tx: ReturnType<typeof montar>['tx']) => tx.pagamentoFatura.create.mock.calls.map((c) => (c[0] as Criado).data);

describe('BaixaContaService.aplicarPagamentoDeIntencao', () => {
  it('duas faturas com R$ 1.272,43: quita a de 02/11 (em atraso) e deixa a de 09/11 em R$ 849,00', async () => {
    const { service, tx, carregar } = montar(contaFixture([F2(), F3()]));
    const r = await service.aplicarPagamentoDeIntencao(job(127243));
    expect(r).toEqual({ resultado: 'aplicado', faturas: 2, excedente: 0 });
    // A conta é carregada DENTRO da transação que a trava.
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(carregar).toHaveBeenCalledWith('conta-1', { db: tx });

    const pg = criados(tx);
    expect(pg.map((p) => [p.faturaId, p.valor, p.valorExcedente, p.gatewayPaymentId, p.intencaoId, p.origem])).toEqual([
      ['f2', '1072.43', '0.00', 'pay_123', 'int_1', 'GATEWAY'],
      ['f3', '200.00', '0.00', 'pay_123', 'int_1', 'GATEWAY'],
    ]);
    // Fatura de 02/11: encargos primeiro (multa 20,98 + 7 dias 2,45), depois proteção, acessórios, principal.
    expect(pg[0].alocacoes!.create).toEqual([
      { itemFaturaId: null, tipoEncargo: 'MULTA', valor: '20.98', nivel: 1, quitou: true },
      { itemFaturaId: null, tipoEncargo: 'ATUALIZACAO', valor: '2.45', nivel: 1, quitou: true },
      { itemFaturaId: 'f2:protecao', tipoEncargo: null, valor: '50.00', nivel: 2, quitou: true },
      { itemFaturaId: 'f2:reemb', tipoEncargo: null, valor: '120.00', nivel: 3, quitou: true },
      { itemFaturaId: 'f2:acordo', tipoEncargo: null, valor: '180.00', nivel: 3, quitou: true },
      { itemFaturaId: 'f2:veiculo', tipoEncargo: null, valor: '699.00', nivel: 4, quitou: true },
    ]);
    // Fatura de 09/11: proteção 50 inteira; Reembolso 60 e Acordo 90 no rateio.
    expect(pg[1].alocacoes!.create.map((a) => [a.itemFaturaId, a.valor, a.quitou])).toEqual([
      ['f3:protecao', '50.00', true],
      ['f3:reemb', '60.00', false],
      ['f3:acordo', '90.00', false],
    ]);

    expect(tx.fatura.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'f2' }, data: { valorPago: '1072.43', status: 'PAGA_EM_ATRASO', dataPagamento: new Date('2026-11-09T00:00:00.000Z') } },
      { where: { id: 'f3' }, data: { valorPago: '200.00' } }, // parcial: segue FECHADA
    ]);
  });

  it('efeitos nas parcelas: quitada vira PAGA_EM_ATRASO com recebível realizado; coberta em parte fica em aberto', async () => {
    const { service, tx } = montar(contaFixture([F2(), F3()]));
    await service.aplicarPagamentoDeIntencao(job(127243));
    const parcelas = Object.fromEntries(tx.parcela.update.mock.calls.map((c) => [(c[0] as { where: { id: string } }).where.id, (c[0] as { data: Record<string, unknown> }).data]));
    // f2: encargo pago (23,43) rateado pelo nominal — 16,73 / 2,68 / 4,02.
    expect(parcelas['f2:pv']).toEqual({ valorPago: '765.73', valorEncargo: '16.73', status: 'PAGA_EM_ATRASO', dataPagamento: new Date('2026-11-09T00:00:00.000Z') });
    expect(parcelas['f2:pr']).toEqual({ valorPago: '122.68', valorEncargo: '2.68', status: 'PAGA_EM_ATRASO', dataPagamento: new Date('2026-11-09T00:00:00.000Z') });
    expect(parcelas['f2:pa']).toEqual({ valorPago: '184.02', valorEncargo: '4.02', status: 'PAGA_EM_ATRASO', dataPagamento: new Date('2026-11-09T00:00:00.000Z') });
    // f3: a parcela do veículo só teve a proteção coberta — continua em aberto.
    expect(parcelas['f3:pv']).toEqual({ valorPago: '50.00', valorEncargo: '0.00' });
    expect(parcelas['f3:pr']).toEqual({ valorPago: '60.00', valorEncargo: '0.00' });
    expect(parcelas['f3:pa']).toEqual({ valorPago: '90.00', valorEncargo: '0.00' });
    // Recebível realizado só das parcelas quitadas, pelo nominal.
    expect(tx.recebivel.updateMany.mock.calls.map((c) => [(c[0] as { where: { parcelaId: string } }).where.parcelaId, (c[0] as { data: { valorRealizado: string } }).data.valorRealizado])).toEqual([
      ['f2:pv', '749.00'],
      ['f2:pr', '120.00'],
      ['f2:pa', '180.00'],
    ]);
    // Contratos com parcela quitada passam pelo teste de encerramento; ainda há parcelas em aberto.
    expect(tx.parcela.count).toHaveBeenCalledTimes(2);
    expect(tx.contratoCredito.update).not.toHaveBeenCalled();
  });

  it('parcial de R$ 540 em 07/11 e quitação em 09/11: refaz a conta pelos pagamentos gravados (532,08) e fecha em 1.072,08', async () => {
    // 1º pagamento, em 07/11.
    const primeira = montar(contaFixture([F2()]));
    await primeira.service.aplicarPagamentoDeIntencao(job(54000, { dataPagamento: '2026-11-07', pagamentoId: 'pay_1' }));
    expect(primeira.tx.fatura.update.mock.calls[0][0]).toEqual({ where: { id: 'f2' }, data: { valorPago: '540.00' } });

    // Estado gravado depois do 1º pagamento (o que o banco devolveria).
    const f2 = F2();
    const { baixas } = aplicarPagamentoNaConta([reconstituirFatura(f2.motor)], { data: '2026-11-07', valor: 54000 });
    f2.motor.pagamentos = [{ data: '2026-11-07', valor: 54000, alocacoes: baixas[0].alocacoes }];
    f2.valorPago = 54000;
    f2.parcelas = f2.parcelas.map((p) => (p.id === 'f2:pv' ? { ...p, valorPago: 5000 + 16727 + 1623, valorEncargo: 1623 } : { ...p, emAberto: false }));

    const segunda = montar(contaFixture([f2]));
    const r = await segunda.service.aplicarPagamentoDeIntencao(job(53208, { pagamentoId: 'pay_2' }));
    expect(r).toEqual({ resultado: 'aplicado', faturas: 1, excedente: 0 });
    const pg = criados(segunda.tx)[0];
    expect(pg.valor).toBe('532.08');
    expect(pg.alocacoes!.create).toEqual([
      { itemFaturaId: null, tipoEncargo: 'ATUALIZACAO', valor: '0.35', nivel: 1, quitou: true }, // 2 dias sobre 531,73 — sem multa nova
      { itemFaturaId: 'f2:veiculo', tipoEncargo: null, valor: '531.73', nivel: 4, quitou: true },
    ]);
    expect(segunda.tx.fatura.update.mock.calls[0][0]).toEqual({
      where: { id: 'f2' },
      data: { valorPago: '1072.08', status: 'PAGA_EM_ATRASO', dataPagamento: new Date('2026-11-09T00:00:00.000Z') },
    });
  });

  it('IDEMPOTENTE pelo id do pagamento: o mesmo Pix chegando de novo não grava nada', async () => {
    const { service, tx, carregar } = montar(contaFixture([F2()]), { jaAplicado: true });
    expect(await service.aplicarPagamentoDeIntencao(job(107243))).toEqual({ resultado: 'ja_aplicado', faturas: 0, excedente: 0 });
    expect(tx.pagamentoFatura.findFirst).toHaveBeenCalledWith({ where: { gatewayPaymentId: 'pay_123' }, select: { id: true } });
    expect(carregar).not.toHaveBeenCalled();
    expect(tx.pagamentoFatura.create).not.toHaveBeenCalled();
    expect(tx.fatura.update).not.toHaveBeenCalled();
    expect(tx.intencaoPagamento.update).not.toHaveBeenCalled();
  });

  it('EXCEDENTE: pago além do que a conta deve fica em valorExcedente da última fatura tocada e avisa a carteira', async () => {
    const { service, tx, notificacao } = montar(contaFixture([F2(), F3()]));
    const r = await service.aplicarPagamentoDeIntencao(job(107243 + 104900 + 1500));
    expect(r).toEqual({ resultado: 'aplicado_com_excedente', faturas: 2, excedente: 1500 });
    expect(criados(tx).map((p) => [p.faturaId, p.valorExcedente])).toEqual([['f2', '0.00'], ['f3', '15.00']]);
    expect(notificacao.emitir).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'DINHEIRO', area: 'CARTEIRA_COBRANCA', rota: '/titulares/tit-1' }));
  });

  it('Pix de intenção EXPIRADA ou SUBSTITUIDA pago mesmo assim é ACEITO e aplicado pela regra normal', async () => {
    for (const situacao of ['EXPIRADA', 'SUBSTITUIDA']) {
      const { service, tx, notificacao } = montar(contaFixture([F2()]), { situacaoIntencao: situacao });
      const r = await service.aplicarPagamentoDeIntencao(job(60000));
      expect(r).toEqual({ resultado: 'aplicado', faturas: 1, excedente: 0 });
      expect(criados(tx)[0]).toMatchObject({ faturaId: 'f2', valor: '600.00' });
      expect(tx.intencaoPagamento.update).toHaveBeenCalledWith({ where: { id: 'int_1' }, data: expect.objectContaining({ situacao: 'PAGA', valorRecebido: '600.00' }) });
      expect(notificacao.emitir).toHaveBeenCalledTimes(1); // a carteira fica sabendo que o Pix já não valia
    }
  });

  it('conta sem nada em aberto: o valor inteiro é registrado como excedente, sem recusar o dinheiro', async () => {
    const { service, tx } = montar(contaFixture([]));
    const r = await service.aplicarPagamentoDeIntencao(job(50000));
    expect(r).toEqual({ resultado: 'so_excedente', faturas: 0, excedente: 50000 });
    expect(criados(tx)).toEqual([expect.objectContaining({ faturaId: 'f-ultima', valor: '0.00', valorExcedente: '500.00', gatewayPaymentId: 'pay_123' })]);
    expect(tx.fatura.update).not.toHaveBeenCalled();
  });

  it('quitação: contrato sem parcela em aberto é ENCERRADO por QUITACAO', async () => {
    const { service, tx } = montar(contaFixture([F2()]), { parcelasAbertasDoContrato: 0 });
    await service.aplicarPagamentoDeIntencao(job(107243));
    expect(tx.contratoCredito.update.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id).sort()).toEqual(['c-reemb', 'c-veiculo']);
    expect(tx.contratoCredito.update).toHaveBeenCalledWith({ where: { id: 'c-veiculo' }, data: { status: 'ENCERRADO', motivoEncerramento: 'QUITACAO', dataEncerramento: new Date('2026-11-09T00:00:00.000Z') } });
  });

  it('o saldo mudou: TODAS as outras intenções ATIVAS da conta deixam de valer e o cancelamento dos Pix vai para a fila', async () => {
    // Regra 15/11: pode haver várias ativas (uma por valor); gerar não cancela — quem cancela é a baixa.
    const outras = [{ id: 'int_2', gatewayId: 'pay_2' }, { id: 'int_3', gatewayId: 'pay_3' }, { id: 'int_4', gatewayId: null }];
    const { service, tx, intencoes } = montar(contaFixture([F2()]), { outrasAtivas: outras });
    await service.aplicarPagamentoDeIntencao(job(60000));
    // Procura todas as ativas da conta, de qualquer dia, menos a que foi paga.
    expect(tx.intencaoPagamento.findMany).toHaveBeenCalledWith({ where: { contaId: 'conta-1', situacao: 'ATIVA', id: { not: 'int_1' } }, select: { id: true, gatewayId: true } });
    expect(tx.intencaoPagamento.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['int_2', 'int_3', 'int_4'] } }, data: { situacao: 'SUBSTITUIDA' } });
    // Fora da transação e fora do caminho do webhook: pela fila, uma por intenção.
    expect(intencoes.enfileirarCancelamento.mock.calls).toEqual([['int_2', 'pay_2'], ['int_3', 'pay_3'], ['int_4', null]]);
  });

  it('o dinheiro manda: a 2ª intenção paga antes do cancelamento é aplicada normalmente (próxima fatura ou excedente)', async () => {
    // A 1ª baixa já marcou esta como SUBSTITUIDA; o Pix dela foi pago mesmo assim.
    const { service, tx } = montar(contaFixture([F2()]), { situacaoIntencao: 'SUBSTITUIDA' });
    const r = await service.aplicarPagamentoDeIntencao(job(107243 + 5000, { pagamentoId: 'pay_segundo' }));
    expect(r).toEqual({ resultado: 'aplicado_com_excedente', faturas: 1, excedente: 5000 });
    expect(criados(tx)[0]).toMatchObject({ faturaId: 'f2', valor: '1072.43', valorExcedente: '50.00', gatewayPaymentId: 'pay_segundo' });
  });

  it('referência de intenção que não existe: nada é baixado e a carteira é avisada', async () => {
    const { service, db, notificacao } = montar(contaFixture([F2()]), { intencaoExiste: false });
    expect(await service.aplicarPagamentoDeIntencao(job(60000))).toEqual({ resultado: 'intencao_nao_encontrada', faturas: 0, excedente: 0 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(notificacao.emitir).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'FALHA' }));
  });

  it('sem data informada pelo gateway, vale o dia (Brasil) em que soubemos do pagamento — nunca o dia em UTC', async () => {
    const { service, tx } = montar(contaFixture([F2()]));
    // 10/11 01:30Z = 09/11 22:30 em Brasília.
    await service.aplicarPagamentoDeIntencao(job(107243, { dataPagamento: null, recebidoEm: '2026-11-10T01:30:00.000Z' }));
    expect(tx.fatura.update.mock.calls[0][0]).toMatchObject({ data: { valorPago: '1072.43', dataPagamento: new Date('2026-11-09T00:00:00.000Z') } });
  });
});
