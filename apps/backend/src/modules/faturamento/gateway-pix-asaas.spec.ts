import { AsaasService } from '../asaas/asaas.service';
import { valorDoPayloadPix } from '../asaas/pix';
import { GatewayPixAsaas } from './gateway-pix-asaas';

// Adaptador Asaas do GatewayPix (doc 02 §32.4-A): Pix avulso com vencimento no
// dia, SEM multa nem juros nativos, referência intencao:<id>; modo simulado;
// cancelamento que nunca apaga cobrança paga; leitura do webhook.

const titular = { id: 'tit-1', nome: 'Carlos Souza', cpfCnpj: '12345678901', email: null, whatsapp: '27999990000', asaasCustomerId: 'cus_real_1' };

function montar(opts: { apiKey?: string; cobranca?: Record<string, unknown> | null } = {}) {
  const integracoes = { asaas: () => ({ apiKey: opts.apiKey ?? '', apiUrl: 'https://asaas.teste/v3', webhookSecret: '', ambiente: 'sandbox', fonte: 'env' }) };
  const asaas = new AsaasService(integracoes as never);
  const leitura = {
    pixQrCode: jest.fn().mockResolvedValue({ payload: 'COPIA-E-COLA-REAL', encodedImage: 'PNGBASE64', expirationDate: null }),
    lerCobranca: jest.fn().mockResolvedValue(opts.cobranca ?? null),
  };
  const prisma = { db: { titular: { findFirst: jest.fn().mockResolvedValue(titular), update: jest.fn() } } };
  return { gateway: new GatewayPixAsaas(prisma as never, asaas, leitura as never), leitura, asaas, prisma };
}

const pedido = { referencia: 'intencao:int_abc', valor: 107243, dia: '2026-11-09', descricao: 'Azit Move — pagamento de fatura #22', titularId: 'tit-1' };

describe('GatewayPixAsaas', () => {
  afterEach(() => jest.restoreAllMocks());

  it('MODO SIMULADO (sem chave): não chama a rede e devolve um código de teste com o valor exato', async () => {
    const { gateway } = montar();
    const rede = jest.spyOn(global, 'fetch');
    const pix = await gateway.criarPix(pedido);
    expect(rede).not.toHaveBeenCalled();
    expect(pix).toMatchObject({ gatewayId: 'pay_sim_intencao:int_abc', simulado: true, qrCodeImagem: null });
    expect(valorDoPayloadPix(pix.copiaECola)).toBe(107243);
    expect(await gateway.cancelarPix(pix.gatewayId)).toEqual({ cancelado: true, pago: false });
  });

  it('MODO REAL: cobrança PIX avulsa com vencimento hoje, valor exato e SEM fine/interest', async () => {
    const { gateway, leitura } = montar({ apiKey: 'chave' });
    const rede = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'pay_123', status: 'PENDING' }) } as never);
    const pix = await gateway.criarPix(pedido);
    expect(rede).toHaveBeenCalledTimes(1);
    const [url, init] = rede.mock.calls[0];
    expect(url).toBe('https://asaas.teste/v3/payments');
    const corpo = JSON.parse((init as { body: string }).body) as Record<string, unknown>;
    expect(corpo).toEqual({ customer: 'cus_real_1', billingType: 'PIX', value: 1072.43, dueDate: '2026-11-09', externalReference: 'intencao:int_abc', description: pedido.descricao });
    expect(corpo).not.toHaveProperty('fine');
    expect(corpo).not.toHaveProperty('interest');
    expect(leitura.pixQrCode).toHaveBeenCalledWith('pay_123');
    expect(pix).toEqual({ gatewayId: 'pay_123', copiaECola: 'COPIA-E-COLA-REAL', qrCodeImagem: 'PNGBASE64', simulado: false });
  });

  it('não mexe no cadastro do cliente existente: reusa o id e não chama /customers', async () => {
    const { gateway, prisma } = montar({ apiKey: 'chave' });
    const rede = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'pay_1', status: 'PENDING' }) } as never);
    await gateway.criarPix(pedido);
    expect(rede.mock.calls.map((c) => c[0])).toEqual(['https://asaas.teste/v3/payments']);
    expect(prisma.db.titular.update).not.toHaveBeenCalled();
  });

  it('sem o código Pix, a cobrança recém-criada é removida e o erro sobe', async () => {
    const { gateway, leitura, asaas } = montar({ apiKey: 'chave' });
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'pay_9', status: 'PENDING' }) } as never);
    leitura.pixQrCode.mockRejectedValueOnce(new Error('QR indisponível'));
    const remover = jest.spyOn(asaas, 'removerCobranca').mockResolvedValue(true);
    await expect(gateway.criarPix(pedido)).rejects.toThrow('QR indisponível');
    expect(remover).toHaveBeenCalledWith('pay_9');
  });

  it('cancelar NUNCA apaga cobrança paga: devolve pago=true para quem chamou enfileirar a baixa', async () => {
    const paga = montar({ apiKey: 'chave', cobranca: { id: 'pay_1', status: 'RECEIVED', value: 600, clientPaymentDate: '2026-11-09' } });
    const removerPaga = jest.spyOn(paga.asaas, 'removerCobranca');
    expect(await paga.gateway.cancelarPix('pay_1')).toEqual({ cancelado: false, pago: true });
    expect(removerPaga).not.toHaveBeenCalled();
    expect(await paga.gateway.consultarPix('pay_1')).toEqual({ existe: true, pago: true, valor: 60000, dataPagamento: '2026-11-09', pagamentoId: 'pay_1' });

    const pendente = montar({ apiKey: 'chave', cobranca: { id: 'pay_2', status: 'PENDING', value: 600 } });
    const remover = jest.spyOn(pendente.asaas, 'removerCobranca').mockResolvedValue(true);
    expect(await pendente.gateway.cancelarPix('pay_2')).toEqual({ cancelado: true, pago: false });
    expect(remover).toHaveBeenCalledWith('pay_2');

    const sumiu = montar({ apiKey: 'chave', cobranca: null });
    expect(await sumiu.gateway.cancelarPix('pay_3')).toEqual({ cancelado: true, pago: false });
  });

  it('lê o webhook: só evento com referência intencao:, com data do cliente e identificador do Pix', () => {
    const { gateway } = montar();
    expect(
      gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', externalReference: 'intencao:int_abc', value: 1072.43, paymentDate: '2026-11-10', clientPaymentDate: '2026-11-09', pixTransaction: 'E18236120202611091203' } }),
    ).toEqual({ referencia: 'intencao:int_abc', pago: true, pagamentoId: 'pay_1', valor: 107243, dataPagamento: '2026-11-09', identificadorPix: 'E18236120202611091203' });
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1', externalReference: 'intencao:int_abc', value: 10 } })).toMatchObject({ pago: false });
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_2', externalReference: 'fatura-id', value: 10 } })).toBeNull();
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED' })).toBeNull();
  });
});
