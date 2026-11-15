import { GatewayPixAsaas } from '../faturamento/gateway-pix-asaas';
import { WebhookController } from './webhook.controller';

// Webhook do Asaas com referência `intencao:<id>` (doc 02 §32.4-A): responde na
// hora e ENFILEIRA a baixa pela conta (Regra 4) — nunca aplica nada de forma
// síncrona. Os outros prefixos e a fatura sem prefixo seguem pelo caminho antigo.

function montar() {
  const fila = () => ({ add: jest.fn().mockResolvedValue({}) });
  const filas = { recebido: fila(), vencido: fila(), acordo: fila(), ativacao: fila() };
  const intencao = { enfileirarBaixa: jest.fn().mockResolvedValue(undefined) };
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

  it('REGRESSÃO: fatura sem prefixo (modelo ASAAS_NATIVO) continua no job conciliar de sempre', async () => {
    const { controller, filas, intencao } = montar();
    await controller.asaas(undefined, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9', externalReference: 'fat_1', value: 1049, paymentDate: '2026-11-09', dueDate: '2026-11-09' } });
    expect(filas.recebido.add).toHaveBeenCalledWith('conciliar', { faturaId: 'fat_1', paymentDate: '2026-11-09', dueDate: '2026-11-09', valor: 104900 });
    expect(intencao.enfileirarBaixa).not.toHaveBeenCalled();
  });
});
