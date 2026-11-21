import { Prisma } from '@prisma/client';
import { GatewayPixAsaas } from '../faturamento/gateway-pix-asaas';
import { AtivacaoProcessor } from '../funil/ativacao.processor';
import { FormalizacaoService } from '../funil/formalizacao.service';
import { bancoFrouxo, intencoesStub, semAzit } from '../operacoes/azit.fixture-spec';
import { EfetivarAcordoProcessor } from '../operacoes/efetivar-acordo.processor';
import { NovacaoService } from '../operacoes/novacao.service';
import { RenegociacaoService } from '../operacoes/renegociacao.service';
import { entradaPagaAMenor } from './entrada-recebida';
import { WebhookController } from './webhook.controller';

// Decisão Luís 15/11 (doc 02 §32.6): pagamento em parte existe SÓ dentro das
// faturas. Entrada de contrato (`ativacao:`), entrada de acordo (`acordo:`) e
// recebimento inicial de novação (`novacao:`) só valem pelo valor inteiro:
// recebido abaixo disso não ativa nem efetiva — registra e avisa a carteira.

const dec = (reais: number) => new Prisma.Decimal(reais.toFixed(2));
const falhaParaCarteira = (titulo: RegExp) => ({ data: expect.objectContaining({ titulo: expect.stringMatching(titulo), tipo: 'FALHA', area: 'CARTEIRA_COBRANCA' }) });

describe('entradaPagaAMenor', () => {
  it('só é "a menor" quando o valor veio e é MENOR que a entrada; igual ou maior vale', () => {
    expect(entradaPagaAMenor(29999, 30000)).toBe(true);
    expect(entradaPagaAMenor(30000, 30000)).toBe(false);
    expect(entradaPagaAMenor(30500, 30000)).toBe(false); // pago com encargo de atraso
  });
  it('job sem valor (simulador de desenvolvimento, caminho interno sem cobrança) não é barrado', () => {
    expect(entradaPagaAMenor(undefined, 30000)).toBe(false);
    expect(entradaPagaAMenor(null, 30000)).toBe(false);
  });
});

describe('Webhook — o valor recebido e o id do pagamento vão no job das três entradas', () => {
  function montar() {
    const fila = () => ({ add: jest.fn().mockResolvedValue({}) });
    const filas = { recebido: fila(), vencido: fila(), acordo: fila(), ativacao: fila() };
    const prisma = { db: { fatura: { findFirst: jest.fn().mockResolvedValue(null) } } };
    const controller = new WebhookController(
      { get: () => 'development' } as never,
      { asaas: () => ({ webhookSecret: '' }) } as never,
      prisma as never,
      filas.recebido as never,
      filas.vencido as never,
      filas.acordo as never,
      filas.ativacao as never,
      new GatewayPixAsaas(prisma as never, { simulado: true } as never, {} as never),
      { enfileirarBaixa: jest.fn() } as never,
    );
    return { controller, filas };
  }
  const recebido = (externalReference: string, value?: number) => ({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', externalReference, value, paymentDate: '2026-11-15' } });

  it('acordo:, novacao: e ativacao: — centavos do que foi recebido, sem decidir nada no webhook', async () => {
    const { controller, filas } = montar();
    await controller.asaas(undefined, recebido('acordo:ac-1', 300));
    await controller.asaas(undefined, recebido('novacao:nv-1', 999.99));
    await controller.asaas(undefined, recebido('ativacao:c-1', 1800));
    expect(filas.acordo.add).toHaveBeenCalledWith('efetivar', { acordoId: 'ac-1', paymentDate: '2026-11-15', valorRecebido: 30000, pagamentoId: 'pay_1' });
    expect(filas.acordo.add).toHaveBeenCalledWith('novacao-recebida', { novacaoId: 'nv-1', paymentDate: '2026-11-15', valorRecebido: 99999, pagamentoId: 'pay_1' });
    expect(filas.ativacao.add).toHaveBeenCalledWith('ativar', { contratoId: 'c-1', paymentDate: '2026-11-15', valorRecebido: 180000, pagamentoId: 'pay_1' });
  });

  it('aviso sem valor: o job segue sem valor (não vira "recebeu zero")', async () => {
    const { controller, filas } = montar();
    await controller.asaas(undefined, recebido('acordo:ac-1'));
    expect(filas.acordo.add).toHaveBeenCalledWith('efetivar', expect.objectContaining({ acordoId: 'ac-1', valorRecebido: undefined }));
  });

  // Boleto único do saldo da rescisão (doc 02 §29.3, 20/11): a referência
  // `rescisao:<id>` NUNCA pode cair na fila de fatura (o id não é de fatura).
  it('rescisao: — pago vai para a fila do acordo; vencido avisa; qualquer outro evento é só recebido', async () => {
    const { controller, filas } = montar();
    await controller.asaas(undefined, recebido('rescisao:r-1', 2816.74));
    expect(filas.acordo.add).toHaveBeenCalledWith('rescisao-saldo-recebido', { rescisaoId: 'r-1', paymentDate: '2026-11-15', valorRecebido: 281674, pagamentoId: 'pay_1' });
    await controller.asaas(undefined, { event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1', externalReference: 'rescisao:r-1', value: 2816.74, dueDate: '2026-12-11' } });
    expect(filas.acordo.add).toHaveBeenCalledWith('rescisao-saldo-vencido', { rescisaoId: 'r-1', pagamentoId: 'pay_1' });
    await controller.asaas(undefined, { event: 'PAYMENT_DELETED', payment: { id: 'pay_1', externalReference: 'rescisao:r-1', value: 2816.74 } });
    expect(filas.acordo.add).toHaveBeenCalledTimes(2);
    expect(filas.recebido.add).not.toHaveBeenCalled();
    expect(filas.vencido.add).not.toHaveBeenCalled();
  });
});

describe('Processadores — repassam o que foi recebido a quem efetiva', () => {
  const dados = { paymentDate: '2026-11-15', valorRecebido: 30000, pagamentoId: 'pay_1' };

  it('ativar', async () => {
    const formalizacao = { contratoExiste: jest.fn().mockResolvedValue(true), ativarPacotePorPagamento: jest.fn().mockResolvedValue({ status: 'entrada_a_menor', contratosAtivados: 0 }) };
    const r = await new AtivacaoProcessor(formalizacao as never, {} as never).process({ name: 'ativar', data: { contratoId: 'c-1', ...dados } } as never);
    expect(formalizacao.ativarPacotePorPagamento).toHaveBeenCalledWith('c-1', '2026-11-15', { valorRecebido: 30000, pagamentoId: 'pay_1' });
    expect(r).toMatchObject({ status: 'entrada_a_menor' });
  });

  it('efetivar (acordo) e novacao-recebida', async () => {
    const renegociacao = { efetivar: jest.fn().mockResolvedValue({ resultado: 'entrada_a_menor' }) };
    const novacao = { ativar: jest.fn().mockResolvedValue({ resultado: 'entrada_a_menor' }) };
    const p = new EfetivarAcordoProcessor(renegociacao as never, novacao as never, {} as never);
    await p.process({ name: 'efetivar', data: { acordoId: 'ac-1', ...dados } } as never);
    await p.process({ name: 'novacao-recebida', data: { novacaoId: 'nv-1', ...dados } } as never);
    expect(renegociacao.efetivar).toHaveBeenCalledWith('ac-1', '2026-11-15', { valorRecebido: 30000, pagamentoId: 'pay_1' });
    expect(novacao.ativar).toHaveBeenCalledWith('nv-1', '2026-11-15', { valorRecebido: 30000, pagamentoId: 'pay_1' });
  });

  it('saldo da rescisão: pago e vencido chegam ao RescisaoService', async () => {
    const rescisao = { saldoRecebido: jest.fn().mockResolvedValue({ resultado: 'saldo_pago' }), saldoVencido: jest.fn().mockResolvedValue({ resultado: 'vencido_avisado' }) };
    const p = new EfetivarAcordoProcessor({} as never, {} as never, rescisao as never);
    await p.process({ name: 'rescisao-saldo-recebido', data: { rescisaoId: 'r-1', ...dados } } as never);
    await p.process({ name: 'rescisao-saldo-vencido', data: { rescisaoId: 'r-1', pagamentoId: 'pay_1' } } as never);
    expect(rescisao.saldoRecebido).toHaveBeenCalledWith('r-1', '2026-11-15', { valorRecebido: 30000, pagamentoId: 'pay_1' });
    expect(rescisao.saldoVencido).toHaveBeenCalledWith('r-1', 'pay_1');
  });
});

describe('Entrada do ACORDO paga a menor (doc 02 §7.7)', () => {
  const acordo = { id: 'ac-1', contaId: 'conta-1', status: 'AGUARDANDO_ENTRADA', valorTotalRenegociado: dec(3000), valorEntrada: dec(500), numeroParcelasNovas: 5, valorParcelaNova: dec(500), periodicidade: 'SEMANAL', snapshotJson: null };
  function montar(logExistente: unknown = null) {
    const { db, chamadas } = bancoFrouxo({
      acordo: { findFirst: jest.fn().mockResolvedValue(acordo) },
      conta: { findFirst: jest.fn().mockResolvedValue({ titular: { nome: 'Maria Souza' } }) },
      logAuditoria: { findFirst: jest.fn().mockResolvedValue(logExistente), create: jest.fn().mockResolvedValue({}) },
    });
    const intencoes = intencoesStub();
    const service = new RenegociacaoService({ db } as never, {} as never, {} as never, {} as never, semAzit() as never, intencoes as never);
    return { service, chamadas, intencoes };
  }

  it('R$ 300 de uma entrada de R$ 500: NÃO efetiva, registra o recebimento e avisa a carteira (FALHA)', async () => {
    const { service, chamadas, intencoes } = montar();
    expect(await service.efetivar('ac-1', '2026-11-15', { valorRecebido: 30000, pagamentoId: 'pay_1' })).toEqual({ resultado: 'entrada_a_menor' });
    expect(chamadas.logAuditoria.create).toHaveBeenCalledWith({
      data: { acao: 'entrada_paga_a_menor', entidade: 'acordo', entidadeId: 'ac-1', depois: { valorRecebido: 30000, valorEntrada: 50000, pagamentoId: 'pay_1' } },
    });
    expect(chamadas.notificacao.create).toHaveBeenCalledWith(falhaParaCarteira(/Entrada do acordo — Maria Souza paga a menor/));
    expect(chamadas.notificacao.create.mock.calls[0][0].data.corpo).toMatch(/Recebidos R\$\s?300,00 de R\$\s?500,00\. O acordo NÃO foi efetivado/);
    // Nada do acordo andou: nenhuma parcela coberta, nenhum Pix cancelado.
    expect(chamadas.acordo.update).toBeUndefined();
    expect(chamadas.parcela).toBeUndefined();
    expect(intencoes.invalidarAtivasDaConta).not.toHaveBeenCalled();
  });

  it('o mesmo pagamento avisado de novo (CONFIRMED depois de RECEIVED, reprocesso) não duplica registro nem aviso', async () => {
    const { service, chamadas } = montar({ id: 'log-1' });
    expect(await service.efetivar('ac-1', '2026-11-15', { valorRecebido: 30000, pagamentoId: 'pay_1' })).toEqual({ resultado: 'entrada_a_menor' });
    expect(chamadas.logAuditoria.findFirst).toHaveBeenCalledWith({
      where: { acao: 'entrada_paga_a_menor', entidade: 'acordo', entidadeId: 'ac-1', depois: { path: ['pagamentoId'], equals: 'pay_1' } },
      select: { id: true },
    });
    expect(chamadas.logAuditoria.create).toBeUndefined(); // nem chegou a gravar
    expect(chamadas.notificacao).toBeUndefined();
  });

  it('entrada inteira (ou job sem valor): a conferência não barra e a efetivação segue', async () => {
    for (const recebido of [{ valorRecebido: 50000, pagamentoId: 'pay_2' }, undefined]) {
      const { service, chamadas } = montar();
      await service.efetivar('ac-1', '2026-11-15', recebido).catch(() => undefined); // o resto do fluxo não é o assunto aqui
      expect(chamadas.logAuditoria?.create ?? jest.fn()).not.toHaveBeenCalled();
      expect(chamadas.contratoCredito.findMany).toHaveBeenCalled(); // passou da conferência
    }
  });
});

describe('Recebimento inicial da NOVAÇÃO pago a menor', () => {
  const novacao = { id: 'nv-1', contaId: 'conta-1', status: 'AGUARDANDO_RECEBIMENTO', recebimentoInicial: dec(1000), contratoVeiculoId: 'c1', contratoTermoId: 'c2', snapshotJson: { dto: {}, simulacao: { frequencia: 'semanal' } } };
  function montar() {
    const { db, chamadas } = bancoFrouxo({
      novacao: { findFirst: jest.fn().mockResolvedValue(novacao), update: jest.fn().mockResolvedValue({}) },
      conta: { findFirst: jest.fn().mockResolvedValue({ titular: { nome: 'João Lima' } }) },
    });
    const intencoes = intencoesStub();
    const service = new NovacaoService({ db } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, intencoes as never);
    return { service, chamadas, intencoes };
  }

  it('R$ 999,99 de R$ 1.000: NÃO ativa (origens seguem vivas), registra e avisa a carteira (FALHA)', async () => {
    const { service, chamadas, intencoes } = montar();
    expect(await service.ativar('nv-1', '2026-11-15', { valorRecebido: 99999, pagamentoId: 'pay_1' })).toEqual({ resultado: 'entrada_a_menor' });
    expect(chamadas.logAuditoria.create).toHaveBeenCalledWith({
      data: { acao: 'entrada_paga_a_menor', entidade: 'novacao', entidadeId: 'nv-1', depois: { valorRecebido: 99999, valorEntrada: 100000, pagamentoId: 'pay_1' } },
    });
    expect(chamadas.notificacao.create).toHaveBeenCalledWith(falhaParaCarteira(/Recebimento inicial da novação — João Lima paga a menor/));
    expect(chamadas.novacao.update).toBeUndefined(); // segue AGUARDANDO_RECEBIMENTO
    expect(chamadas.recebivel).toBeUndefined(); // nenhuma obrigação de origem extinta
    expect(chamadas.contratoCredito).toBeUndefined();
    expect(intencoes.invalidarAtivasDaConta).not.toHaveBeenCalled();
  });
});

describe('Entrada do CONTRATO paga a menor (ativação, doc 02 §4-A.3)', () => {
  function montar(entradaParcelada: boolean) {
    const contrato = { id: 'c-1', numero: '2026110001', propostaPacoteId: null, contaId: 'conta-1', valorEntrada: dec(3000), entradaParcelada, entradaPagaEm: null, entradaCobrancaAsaasId: 'pay_1', status: 'AGUARDANDO_PAGAMENTO_INICIAL' };
    const { db, chamadas } = bancoFrouxo({ contratoCredito: { findFirst: jest.fn().mockResolvedValue(contrato) } });
    const notificacao = { emitir: jest.fn().mockResolvedValue(undefined) };
    const service = new FormalizacaoService({ db } as never, {} as never, {} as never, {} as never, {} as never, notificacao as never, {} as never, {} as never);
    return { service, chamadas };
  }

  it('R$ 2.000 de uma entrada de R$ 3.000: NÃO é dia zero — sem cronograma, com registro e aviso à carteira (FALHA)', async () => {
    const { service, chamadas } = montar(false);
    const r = await service.ativarPacotePorPagamento('c-1', '2026-11-15', { valorRecebido: 200000, pagamentoId: 'pay_1' });
    expect(r).toEqual({ contratoId: 'c-1', numero: '2026110001', status: 'entrada_a_menor', cronogramaGerado: false, contratosAtivados: 0 });
    expect(chamadas.logAuditoria.create).toHaveBeenCalledWith({
      data: { acao: 'entrada_paga_a_menor', entidade: 'contrato_credito', entidadeId: 'c-1', depois: { valorRecebido: 200000, valorEntrada: 300000, pagamentoId: 'pay_1' } },
    });
    expect(chamadas.notificacao.create).toHaveBeenCalledWith(falhaParaCarteira(/Entrada do contrato 2026110001 paga a menor/));
    expect(chamadas.notificacao.create.mock.calls[0][0].data.rota).toBe('/contratos/c-1');
    expect(chamadas.contratoCredito.update).toBeUndefined();
    expect(chamadas.proposta).toBeUndefined(); // não chegou à geração do cronograma
  });

  it('entrada parcelada: a régua são os 60% cobrados à vista (R$ 1.800), não a entrada cheia', async () => {
    const menor = montar(true);
    expect((await menor.service.ativarPacotePorPagamento('c-1', '2026-11-15', { valorRecebido: 179999, pagamentoId: 'pay_1' })).status).toBe('entrada_a_menor');
    expect(menor.chamadas.logAuditoria.create.mock.calls[0][0].data.depois).toMatchObject({ valorEntrada: 180000 });

    const inteira = montar(true);
    await inteira.service.ativarPacotePorPagamento('c-1', '2026-11-15', { valorRecebido: 180000, pagamentoId: 'pay_1' }).catch(() => undefined);
    expect(inteira.chamadas.logAuditoria).toBeUndefined();
    expect(inteira.chamadas.proposta.count).toHaveBeenCalled(); // passou da conferência e seguiu para o dia zero
  });
});
