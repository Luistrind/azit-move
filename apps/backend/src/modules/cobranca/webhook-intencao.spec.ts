import { GatewayPixAsaas } from '../faturamento/gateway-pix-asaas';
import { WebhookController } from './webhook.controller';

// Webhook do Asaas com referência `intencao:<id>` (doc 02 §32.4-A): responde na
// hora e ENFILEIRA a baixa pela conta (Regra 4) — nunca aplica nada de forma
// síncrona. Os outros prefixos e a fatura sem prefixo seguem pelo caminho antigo.

function montar() {
  const fila = () => ({ add: jest.fn().mockResolvedValue({}) });
  const filas = { recebido: fila(), vencido: fila(), acordo: fila(), ativacao: fila() };
  const intencao = { enfileirarBaixa: jest.fn().mockResolvedValue(undefined), enfileirarIdentificacao: jest.fn().mockResolvedValue(undefined) };
  const prisma = { db: { fatura: { findFirst: jest.fn().mockResolvedValue(null) } } };
  const gateway = new GatewayPixAsaas(prisma as never, { simulado: true } as never, {} as never);
  const controller = new WebhookController(
    { get: () => 'development' } as never,
    { asaas: () => ({ webhookSecret: '' }) } as never,
    prisma as never,
    filas.recebido as never,
    filas.vencido as never,
    filas.acordo as never,
    filas.ativacao as never,
    gateway,
    intencao as never,
  );
  return { controller, filas, intencao, prisma };
}

describe('WebhookController — prefixo intencao:', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-09T21:22:00.000Z')));
  afterAll(() => jest.useRealTimers());

  it('Pix recebido: só enfileira a baixa pela conta, com o id do pagamento, o valor em centavos e a data do cliente', async () => {
    const { controller, filas, intencao, prisma } = montar();
    const r = await controller.asaas(undefined, {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_123', externalReference: 'intencao:int_abc', value: 1272.43, paymentDate: '2026-11-10', clientPaymentDate: '2026-11-09', pixTransaction: 'E182' },
    });
    expect(r).toEqual({ received: true });
    expect(intencao.enfileirarBaixa).toHaveBeenCalledWith({
      intencaoId: 'int_abc',
      pagamentoId: 'pay_123',
      valor: 127243,
      dataPagamento: '2026-11-09',
      recebidoEm: '2026-11-09T21:22:00.000Z',
      identificadorPix: 'E182',
      origem: 'GATEWAY',
    });
    // Nada vai para as filas dos outros fluxos nem toca no banco.
    for (const f of Object.values(filas)) expect(f.add).not.toHaveBeenCalled();
    expect(prisma.db.fatura.findFirst).not.toHaveBeenCalled();
  });

  it('PAYMENT_CONFIRMED também enfileira (a idempotência é pelo id do pagamento)', async () => {
    const { controller, intencao } = montar();
    await controller.asaas(undefined, { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_123', externalReference: 'intencao:int_abc', value: 600 } });
    expect(intencao.enfileirarBaixa).toHaveBeenCalledWith(expect.objectContaining({ pagamentoId: 'pay_123', valor: 60000, dataPagamento: null }));
  });

  it('Pix vencido ou removido no gateway: só ACK — não vira job de fatura com id inválido', async () => {
    const { controller, filas, intencao } = montar();
    for (const event of ['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_CREATED']) {
      expect(await controller.asaas(undefined, { event, payment: { id: 'pay_123', externalReference: 'intencao:int_abc', value: 600 } })).toEqual({ received: true });
    }
    expect(intencao.enfileirarBaixa).not.toHaveBeenCalled();
    for (const f of Object.values(filas)) expect(f.add).not.toHaveBeenCalled();
  });

  it('REGRESSÃO: cobrança LEGADA sem referência (amarrada à fatura pelo id) continua no conciliar — não vira identificação de Pix', async () => {
    const { controller, filas, intencao, prisma } = montar();
    prisma.db.fatura.findFirst.mockResolvedValueOnce({ id: 'fat_legada' });
    await controller.asaas(undefined, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_legado', billingType: 'PIX', value: 997, paymentDate: '2026-11-09', dueDate: '2026-11-09' } });
    expect(filas.recebido.add).toHaveBeenCalledWith('conciliar', { faturaId: 'fat_legada', paymentDate: '2026-11-09', dueDate: '2026-11-09', valor: 99700 });
    expect(intencao.enfileirarIdentificacao).not.toHaveBeenCalled();
  });

  it('REGRESSÃO: fatura sem prefixo (modelo ASAAS_NATIVO) continua no job conciliar de sempre', async () => {
    const { controller, filas, intencao } = montar();
    await controller.asaas(undefined, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9', externalReference: 'fat_1', value: 1049, paymentDate: '2026-11-09', dueDate: '2026-11-09' } });
    expect(filas.recebido.add).toHaveBeenCalledWith('conciliar', { faturaId: 'fat_1', paymentDate: '2026-11-09', dueDate: '2026-11-09', valor: 104900 });
    expect(intencao.enfileirarBaixa).not.toHaveBeenCalled();
  });
});

// QR estático (doc 02 §32.4-A, 15/11): o pagamento chega como cobrança criada
// pelo gateway, com o id do QR e SEM a nossa referência. Vai SÓ para a
// identificação → baixa pela conta; nunca para a conciliação de fatura.
describe('WebhookController — pagamento de QR estático', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-09T21:22:00.000Z')));
  afterAll(() => jest.useRealTimers());

  it('com pixQrCodeId: enfileira só a identificação — sem conciliação nem os outros fluxos (só confere antes se a cobrança é de alguma fatura)', async () => {
    const { controller, filas, intencao, prisma } = montar();
    const r = await controller.asaas(undefined, {
      event: 'PAYMENT_RECEIVED',
      // `customer` é o pagador que o gateway registrou (pode ser um terceiro): ignorado.
      payment: { id: 'pay_9', externalReference: null, pixQrCodeId: 'qr_abc123', billingType: 'PIX', customer: 'cus_de_terceiro', value: 1072.43, paymentDate: '2026-11-10', clientPaymentDate: '2026-11-09', pixTransaction: 'E182' },
    } as never);
    expect(r).toEqual({ received: true });
    expect(intencao.enfileirarIdentificacao).toHaveBeenCalledWith({ pagamentoId: 'pay_9', gatewayId: 'qr_abc123', valor: 107243, dataPagamento: '2026-11-09', recebidoEm: '2026-11-09T21:22:00.000Z', identificadorPix: 'E182' });
    expect(intencao.enfileirarBaixa).not.toHaveBeenCalled();
    for (const f of Object.values(filas)) expect(f.add).not.toHaveBeenCalled();
    // 18/11: antes de tratar como Pix de QR, confere se o id do pagamento é a cobrança de alguma fatura (não é).
    expect(prisma.db.fatura.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { asaasChargeId: 'pay_9', deletedAt: null } }));
  });

  it('se a referência da intenção vier copiada, a baixa é enfileirada direto (sem identificação)', async () => {
    const { controller, intencao } = montar();
    await controller.asaas(undefined, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9', externalReference: 'intencao:int_abc', pixQrCodeId: 'qr_abc123', value: 600 } });
    expect(intencao.enfileirarBaixa).toHaveBeenCalledWith(expect.objectContaining({ intencaoId: 'int_abc', pagamentoId: 'pay_9', valor: 60000 }));
    expect(intencao.enfileirarIdentificacao).not.toHaveBeenCalled();
  });

  it('outros eventos da cobrança do QR (criada, estornada…) são só ACK', async () => {
    const { controller, filas, intencao } = montar();
    for (const event of ['PAYMENT_CREATED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED']) {
      expect(await controller.asaas(undefined, { event, payment: { id: 'pay_9', pixQrCodeId: 'qr_abc123', value: 600 } })).toEqual({ received: true });
    }
    expect(intencao.enfileirarIdentificacao).not.toHaveBeenCalled();
    for (const f of Object.values(filas)) expect(f.add).not.toHaveBeenCalled();
  });

  it('Pix recebido SEM referência e SEM pixQrCodeId, que não é cobrança de fatura nossa: a identificação fica para o worker (o webhook não consulta o gateway)', async () => {
    const { controller, filas, intencao, prisma } = montar();
    const r = await controller.asaas(undefined, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_5', billingType: 'PIX', value: 600, paymentDate: '2026-11-09' } });
    expect(r).toEqual({ received: true });
    expect(prisma.db.fatura.findFirst).toHaveBeenCalled(); // primeiro vê se é cobrança legada de fatura
    expect(intencao.enfileirarIdentificacao).toHaveBeenCalledWith({ pagamentoId: 'pay_5', gatewayId: null, valor: 60000, dataPagamento: '2026-11-09', recebidoEm: '2026-11-09T21:22:00.000Z', identificadorPix: null });
    for (const f of Object.values(filas)) expect(f.add).not.toHaveBeenCalled();
  });

  it('o que não é Pix, ou não é recebimento, continua ignorado como antes', async () => {
    const { controller, intencao } = montar();
    expect(await controller.asaas(undefined, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_6', billingType: 'BOLETO', value: 600 } })).toEqual({ received: true, ignored: true });
    expect(await controller.asaas(undefined, { event: 'PAYMENT_CREATED', payment: { id: 'pay_7', billingType: 'PIX', value: 600 } })).toEqual({ received: true, ignored: true });
    expect(await controller.asaas(undefined, { event: 'PAYMENT_RECEIVED' })).toEqual({ received: true, ignored: true });
    expect(intencao.enfileirarIdentificacao).not.toHaveBeenCalled();
  });
});

// Correção 18/11 (caso Leonardo, fatura 191): o Asaas também manda `pixQrCodeId` em
// cobrança COMUM paga por Pix. A referência manda — a fatura tem de ser baixada.
describe('WebhookController — cobrança de fatura paga por Pix (com pixQrCodeId)', () => {
  it('com externalReference da fatura: vai para a conciliação da fatura, não para a identificação de Pix', async () => {
    const { controller, filas, intencao } = montar();
    const r = await controller.asaas(undefined, {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_fat191', externalReference: 'fatura_191', pixQrCodeId: 'qr_da_cobranca', billingType: 'PIX', value: 775, paymentDate: '2026-11-18' },
    } as never);
    expect(r).toEqual({ received: true });
    expect(intencao.enfileirarIdentificacao).not.toHaveBeenCalled();
    expect(filas.recebido.add).toHaveBeenCalledTimes(1);
    expect(filas.recebido.add.mock.calls[0][1]).toMatchObject({ faturaId: 'fatura_191', valor: 77500 });
  });

  it('cobrança do legado (sem externalReference, amarrada pelo id): também vai para a conciliação', async () => {
    const { controller, filas, intencao, prisma } = montar();
    prisma.db.fatura.findFirst.mockResolvedValue({ id: 'fatura_legada' });
    await controller.asaas(undefined, {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_legado', externalReference: null, pixQrCodeId: 'qr_da_cobranca', billingType: 'PIX', value: 997, paymentDate: '2026-11-18' },
    } as never);
    expect(intencao.enfileirarIdentificacao).not.toHaveBeenCalled();
    expect(filas.recebido.add.mock.calls[0][1]).toMatchObject({ faturaId: 'fatura_legada', valor: 99700 });
  });

  it('Pix de QR estático sem referência e sem fatura com esse id: continua indo para a identificação', async () => {
    const { controller, filas, intencao } = montar();
    await controller.asaas(undefined, {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_qr', externalReference: null, pixQrCodeId: 'qr_estatico', billingType: 'PIX', value: 600, paymentDate: '2026-11-18' },
    } as never);
    expect(intencao.enfileirarIdentificacao).toHaveBeenCalledTimes(1);
    expect(filas.recebido.add).not.toHaveBeenCalled();
  });
});
