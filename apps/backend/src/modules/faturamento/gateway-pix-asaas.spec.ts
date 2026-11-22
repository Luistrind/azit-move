import { AsaasHttpError } from '../asaas/asaas-leitura.service';
import { AsaasService } from '../asaas/asaas.service';
import { valorDoPayloadPix } from '../asaas/pix';
import { descricaoParaQr, GatewayPixAsaas, mascararChavePix } from './gateway-pix-asaas';

// Adaptador Asaas do GatewayPix (doc 02 §32.4-A), nos dois modos do parâmetro
// `modoPix`: QR ESTÁTICO com valor (padrão, decisão 15/11) e COBRANÇA Pix (o
// anterior). Sem banco e sem rede.

const titular = { id: 'tit-1', nome: 'Carlos Souza', cpfCnpj: '12345678901', email: null, whatsapp: '27999990000', asaasCustomerId: 'cus_real_1' };
const CHAVE = { id: 'key_1', key: 'b6295ee1-f054-47d1-9e90-ee57b74f60d9', type: 'EVP', status: 'ACTIVE' };

type Resposta = unknown | Error;

// `rotas`: resposta por "MÉTODO caminho" (prefixo). Função = resposta calculada a cada chamada.
function montar(opts: { apiKey?: string; modo?: 'ESTATICO' | 'COBRANCA' | null; cobranca?: Record<string, unknown> | null; rotas?: Record<string, Resposta | (() => Resposta)> } = {}) {
  const integracoes = { asaas: () => ({ apiKey: opts.apiKey ?? '', apiUrl: 'https://asaas.teste/v3', webhookSecret: '', ambiente: 'sandbox', fonte: 'env' }) };
  const asaas = new AsaasService(integracoes as never, {} as never);
  const rotas: Record<string, Resposta | (() => Resposta)> = {
    'GET /pix/addressKeys': { data: [CHAVE] },
    'POST /pix/qrCodes/static': { id: 'qr_abc123', payload: 'COPIA-E-COLA-ESTATICO', encodedImage: 'PNGBASE64' },
    'GET /payments?pixQrCodeId=': { data: [] },
    'DELETE /pix/qrCodes/static/': { deleted: true },
    ...(opts.rotas ?? {}),
  };
  const leitura = {
    pixQrCode: jest.fn().mockResolvedValue({ payload: 'COPIA-E-COLA-REAL', encodedImage: 'PNGBASE64', expirationDate: null }),
    lerCobranca: jest.fn().mockResolvedValue(opts.cobranca ?? null),
    requisicao: jest.fn().mockImplementation(async (metodo: string, path: string) => {
      const chave = Object.keys(rotas).find((k) => `${metodo} ${path}`.startsWith(k));
      if (!chave) throw new Error(`rota não esperada no teste: ${metodo} ${path}`);
      const r = typeof rotas[chave] === 'function' ? (rotas[chave] as () => Resposta)() : rotas[chave];
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  // Sem linha de parâmetros valem os padrões: modo ESTATICO.
  const linhaParametros = opts.modo == null ? null : { versao: 1, pixSobDemanda: true, modoPix: opts.modo, multaPadraoPct: '2', atualizacaoMesPadraoPct: '1', cascata: ['ENCARGOS', 'PROTECAO', 'ACESSORIOS', 'PRINCIPAL'], minimoParcialPct: '35', minimoParcialPiso: '200', tetoIntencoesDia: 10, motivo: null, createdAt: new Date() };
  const prisma = { db: { titular: { findFirst: jest.fn().mockResolvedValue(titular), update: jest.fn() }, parametroFaturamento: { findFirst: jest.fn().mockResolvedValue(linhaParametros) } } };
  const gateway = new GatewayPixAsaas(prisma as never, asaas, leitura as never);
  const chamadas = () => leitura.requisicao.mock.calls.map((c) => `${c[0]} ${c[1]}`);
  return { gateway, leitura, asaas, prisma, chamadas };
}

const pedido = { referencia: 'intencao:int_abc', valor: 107243, dia: '2026-11-09', descricao: 'Azit Move — pagamento de fatura #22 — R$ 1.072,43', descricaoCurta: 'Azit Move fatura 22', titularId: 'tit-1' };

describe('GatewayPixAsaas — QR ESTÁTICO com valor (modo padrão)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cria em UMA chamada: valor exato em reais, pagamento único, validade 23h59 do dia, referência da intenção — sem cobrança nem cliente', async () => {
    const { gateway, leitura, chamadas, prisma } = montar({ apiKey: 'chave' });
    const rede = jest.spyOn(global, 'fetch');
    const pix = await gateway.criarPix(pedido);
    expect(pix).toEqual({ gatewayId: 'qr_abc123', copiaECola: 'COPIA-E-COLA-ESTATICO', qrCodeImagem: 'PNGBASE64', simulado: false });
    expect(chamadas()).toEqual(['GET /pix/addressKeys?status=ACTIVE&limit=10', 'POST /pix/qrCodes/static']);
    const post = leitura.requisicao.mock.calls[1];
    expect(post[2]).toEqual({
      addressKey: CHAVE.key,
      value: 1072.43,
      description: 'Azit Move fatura 22',
      format: 'ALL',
      allowsMultiplePayments: false,
      expirationDate: '2026-11-09 23:59:59',
      externalReference: 'intencao:int_abc',
    });
    expect(post[3]).toMatchObject({ semEspera: true }); // cliente esperando: sem a espera longa do 429
    // Nada de cobrança (/payments), de código de cobrança nem de cadastro de cliente.
    expect(rede).not.toHaveBeenCalled();
    expect(leitura.pixQrCode).not.toHaveBeenCalled();
    expect(prisma.db.titular.findFirst).not.toHaveBeenCalled();
  });

  it('a chave Pix fica em memória: o segundo Pix não consulta as chaves de novo', async () => {
    const { gateway, chamadas } = montar({ apiKey: 'chave' });
    await gateway.criarPix(pedido);
    await gateway.criarPix({ ...pedido, referencia: 'intencao:int_def' });
    expect(chamadas().filter((c) => c.startsWith('GET /pix/addressKeys'))).toHaveLength(1);
    expect(chamadas().filter((c) => c.startsWith('POST /pix/qrCodes/static'))).toHaveLength(2);
  });

  it('SEM chave Pix ativa: erro claro, nenhum QR é pedido, e a tela recebe o motivo', async () => {
    const { gateway, chamadas } = montar({ apiKey: 'chave', rotas: { 'GET /pix/addressKeys': { data: [] } } });
    await expect(gateway.criarPix(pedido)).rejects.toThrow(/não tem chave Pix ativa/);
    expect(chamadas().some((c) => c.startsWith('POST'))).toBe(false);
    expect(await gateway.chaveRecebimento()).toEqual({ simulado: false, disponivel: false, chaveMascarada: null, tipoChave: null, motivo: expect.stringMatching(/não tem chave Pix ativa/) });
  });

  it('chave trocada no Asaas: a criação falha, a chave é recarregada e, sendo outra, tenta uma vez com ela', async () => {
    const chaves = [{ data: [CHAVE] }, { data: [{ id: 'key_2', key: '11222333000181', type: 'CNPJ', status: 'ACTIVE' }] }];
    const posts: Resposta[] = [new AsaasHttpError(400, 'Asaas POST /pix/qrCodes/static retornou 400: chave inválida'), { id: 'qr_novo', payload: 'PAYLOAD-NOVO' }];
    const { gateway, leitura } = montar({ apiKey: 'chave', rotas: { 'GET /pix/addressKeys': () => chaves.shift()!, 'POST /pix/qrCodes/static': () => posts.shift()! } });
    expect(await gateway.criarPix(pedido)).toMatchObject({ gatewayId: 'qr_novo', copiaECola: 'PAYLOAD-NOVO', qrCodeImagem: null });
    const corpos = leitura.requisicao.mock.calls.filter((c) => c[0] === 'POST').map((c) => (c[2] as { addressKey: string }).addressKey);
    expect(corpos).toEqual([CHAVE.key, '11222333000181']);
  });

  it('falha com a MESMA chave (ou tempo esgotado) não repete: o erro sobe para a página mostrar "Pix indisponível"', async () => {
    const mesma = montar({ apiKey: 'chave', rotas: { 'POST /pix/qrCodes/static': new AsaasHttpError(400, 'valor inválido') } });
    await expect(mesma.gateway.criarPix(pedido)).rejects.toThrow('valor inválido');
    expect(mesma.chamadas().filter((c) => c.startsWith('POST'))).toHaveLength(1);

    const lento = montar({ apiKey: 'chave', rotas: { 'POST /pix/qrCodes/static': new Error('Asaas POST /pix/qrCodes/static não respondeu em 8 s') } });
    await expect(lento.gateway.criarPix(pedido)).rejects.toThrow('não respondeu em 8 s');
    expect(lento.chamadas()).toEqual(['GET /pix/addressKeys?status=ACTIVE&limit=10', 'POST /pix/qrCodes/static']);
  });

  it('MEDIÇÃO: loga a duração total, a da chave e a da criação do QR, no sucesso e na falha', async () => {
    const posts: Resposta[] = [{ id: 'qr_1', payload: 'P' }, new Error('Asaas POST /pix/qrCodes/static não respondeu em 8 s')];
    const { gateway } = montar({ apiKey: 'chave', rotas: { 'POST /pix/qrCodes/static': () => posts.shift()! } });
    const log = jest.spyOn((gateway as unknown as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation(() => undefined);
    await gateway.criarPix(pedido);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^criarPix intencao:int_abc \(107243c\) \[QR estático\]: ok em \d+ ms · chave \d+ ms · POST \/pix\/qrCodes\/static \d+ ms$/));
    await expect(gateway.criarPix(pedido)).rejects.toThrow('não respondeu em 8 s');
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/\[QR estático\]: FALHOU \(Asaas POST .* não respondeu em 8 s\) em \d+ ms/));
  });

  it('consultar: o pagamento é a cobrança que o Asaas criou ao receber (filtro pixQrCodeId)', async () => {
    const pago = montar({ apiKey: 'chave', rotas: { 'GET /payments?pixQrCodeId=': { data: [{ id: 'pay_9', status: 'RECEIVED', value: 1072.43, clientPaymentDate: '2026-11-09', paymentDate: '2026-11-10', customer: 'cus_de_terceiro' }] } } });
    expect(await pago.gateway.consultarPix('qr_abc123')).toEqual({ existe: true, pago: true, valor: 107243, dataPagamento: '2026-11-09', pagamentoId: 'pay_9' });
    expect(pago.chamadas()).toEqual(['GET /payments?pixQrCodeId=qr_abc123&limit=20']);

    const aberto = montar({ apiKey: 'chave' });
    expect(await aberto.gateway.consultarPix('qr_abc123')).toEqual({ existe: true, pago: false, valor: 0, dataPagamento: null, pagamentoId: null });
  });

  it('cancelar NÃO apaga QR que já recebeu: devolve pago=true para quem chamou enfileirar a baixa', async () => {
    const pago = montar({ apiKey: 'chave', rotas: { 'GET /payments?pixQrCodeId=': { data: [{ id: 'pay_9', status: 'CONFIRMED', value: 600 }] } } });
    expect(await pago.gateway.cancelarPix('qr_abc123')).toEqual({ cancelado: false, pago: true });
    expect(pago.chamadas().some((c) => c.startsWith('DELETE'))).toBe(false);
  });

  it('cancelar QR sem pagamento: confere antes e só então remove; QR que o Asaas já não tem conta como cancelado', async () => {
    const aberto = montar({ apiKey: 'chave' });
    expect(await aberto.gateway.cancelarPix('qr_abc123')).toEqual({ cancelado: true, pago: false });
    expect(aberto.chamadas()).toEqual(['GET /payments?pixQrCodeId=qr_abc123&limit=20', 'DELETE /pix/qrCodes/static/qr_abc123']);

    const sumiu = montar({ apiKey: 'chave', rotas: { 'DELETE /pix/qrCodes/static/': new AsaasHttpError(404, 'não encontrado') } });
    expect(await sumiu.gateway.cancelarPix('qr_abc123')).toEqual({ cancelado: true, pago: false });

    // Falha de verdade: não confirma o cancelamento (a fila repete).
    const falhou = montar({ apiKey: 'chave', rotas: { 'DELETE /pix/qrCodes/static/': new AsaasHttpError(500, 'erro') } });
    expect(await falhou.gateway.cancelarPix('qr_abc123')).toEqual({ cancelado: false, pago: false });
  });

  it('MODO SIMULADO (sem chave de API): não chama a rede, devolve código de teste com o valor exato', async () => {
    const { gateway, leitura } = montar();
    const rede = jest.spyOn(global, 'fetch');
    const pix = await gateway.criarPix(pedido);
    expect(rede).not.toHaveBeenCalled();
    expect(leitura.requisicao).not.toHaveBeenCalled();
    expect(pix).toMatchObject({ gatewayId: 'qr_sim_intencao_int_abc', simulado: true, qrCodeImagem: null });
    expect(valorDoPayloadPix(pix.copiaECola)).toBe(107243);
    expect(await gateway.cancelarPix(pix.gatewayId)).toEqual({ cancelado: true, pago: false });
    expect(await gateway.chaveRecebimento()).toEqual({ simulado: true, disponivel: true, chaveMascarada: null, tipoChave: null, motivo: null });
  });

  it('tela de Configurações: chave ativa mascarada e o tipo; consulta que falha vira motivo, não erro', async () => {
    const ok = montar({ apiKey: 'chave' });
    expect(await ok.gateway.chaveRecebimento()).toEqual({ simulado: false, disponivel: true, chaveMascarada: 'b629•••60d9', tipoChave: 'EVP', motivo: null });
    const fora = montar({ apiKey: 'chave', rotas: { 'GET /pix/addressKeys': new Error('Asaas GET /pix/addressKeys não respondeu em 8 s') } });
    expect(await fora.gateway.chaveRecebimento()).toMatchObject({ disponivel: false, chaveMascarada: null, motivo: expect.stringMatching(/Não foi possível consultar/) });
  });

  it('texto do QR: sem acento nem símbolo, no máximo 37 caracteres; chave mascarada por tipo', () => {
    expect(descricaoParaQr('Azit Move fatura 22')).toBe('Azit Move fatura 22');
    expect(descricaoParaQr('Azit Move — pagamento de faturas nº 21 a 23 (atualização)')).toBe('Azit Move pagamento de faturas n 21 a');
    expect(descricaoParaQr('Azit Move — pagamento de faturas nº 21 a 23 (atualização)').length).toBeLessThanOrEqual(37);
    expect(mascararChavePix('financeiro@azitmove.com.br')).toBe('fi•••@azitmove.com.br');
    expect(mascararChavePix('57265780000119')).toBe('5726•••0119');
  });
});

describe('GatewayPixAsaas — webhook', () => {
  it('cobrança criada pelo Asaas ao receber um QR estático: volta pelo id do QR (pixQrCodeId), sem depender da referência', () => {
    const { gateway } = montar();
    expect(
      gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9', externalReference: null, pixQrCodeId: 'qr_abc123', billingType: 'PIX', value: 1072.43, paymentDate: '2026-11-10', clientPaymentDate: '2026-11-09', pixTransaction: 'E182', customer: 'cus_de_terceiro' } }),
    ).toEqual({ referencia: null, gatewayId: 'qr_abc123', pago: true, pagamentoId: 'pay_9', valor: 107243, dataPagamento: '2026-11-09', identificadorPix: 'E182' });
  });

  it('se a referência vier copiada junto com o id do QR, os dois são lidos', () => {
    const { gateway } = montar();
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9', externalReference: 'intencao:int_abc', pixQrCodeId: 'qr_abc123', value: 10 } })).toMatchObject({ referencia: 'intencao:int_abc', gatewayId: 'qr_abc123' });
  });

  it('Pix recebido SEM referência e SEM id do QR ainda é candidato (o worker pergunta ao gateway); o que não é Pix ou tem dono em outro fluxo, não', () => {
    const { gateway } = montar();
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_5', billingType: 'PIX', value: 600 } })).toEqual({ referencia: null, gatewayId: null, pago: true, pagamentoId: 'pay_5', valor: 60000, dataPagamento: null, identificadorPix: null });
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_5', value: 600 } })).toMatchObject({ gatewayId: null, pago: true }); // tipo não informado
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_6', billingType: 'BOLETO', value: 600 } })).toBeNull();
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_2', externalReference: 'fatura-id', value: 10 } })).toBeNull();
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_3', externalReference: 'ativacao:c-1', billingType: 'PIX', value: 10 } })).toBeNull();
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED' })).toBeNull();
  });

  it('cobrança Pix (modo COBRANCA): volta pela referência intencao:, com data do cliente e identificador', () => {
    const { gateway } = montar();
    expect(
      gateway.interpretarWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', externalReference: 'intencao:int_abc', value: 1072.43, paymentDate: '2026-11-10', clientPaymentDate: '2026-11-09', pixTransaction: 'E18236120202611091203' } }),
    ).toEqual({ referencia: 'intencao:int_abc', gatewayId: null, pago: true, pagamentoId: 'pay_1', valor: 107243, dataPagamento: '2026-11-09', identificadorPix: 'E18236120202611091203' });
    expect(gateway.interpretarWebhook({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1', externalReference: 'intencao:int_abc', value: 10 } })).toMatchObject({ pago: false });
  });

  it('aviso sem o id do QR: o pagamento é lido no Asaas para saber de qual QR veio', async () => {
    const doQr = montar({ apiKey: 'chave', cobranca: { id: 'pay_5', status: 'RECEIVED', value: 600, pixQrCodeId: 'qr_abc123' } });
    expect(await doQr.gateway.pixDoPagamento('pay_5')).toBe('qr_abc123');
    expect(doQr.leitura.lerCobranca).toHaveBeenCalledWith('pay_5');
    const avulso = montar({ apiKey: 'chave', cobranca: { id: 'pay_6', status: 'RECEIVED', value: 600, pixQrCodeId: null } });
    expect(await avulso.gateway.pixDoPagamento('pay_6')).toBeNull();
    expect(await montar({ apiKey: 'chave', cobranca: null }).gateway.pixDoPagamento('pay_7')).toBeNull();
  });
});

describe('GatewayPixAsaas — modo COBRANCA (o anterior, opção de volta)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('MODO SIMULADO: não chama a rede e devolve um código de teste com o valor exato', async () => {
    const { gateway } = montar({ modo: 'COBRANCA' });
    const rede = jest.spyOn(global, 'fetch');
    const pix = await gateway.criarPix(pedido);
    expect(rede).not.toHaveBeenCalled();
    expect(pix).toMatchObject({ gatewayId: 'pay_sim_intencao:int_abc', simulado: true, qrCodeImagem: null });
    expect(valorDoPayloadPix(pix.copiaECola)).toBe(107243);
    expect(await gateway.cancelarPix(pix.gatewayId)).toEqual({ cancelado: true, pago: false });
  });

  it('MODO REAL: cobrança PIX avulsa com vencimento hoje, valor exato e SEM fine/interest — e nenhum QR estático', async () => {
    const { gateway, leitura } = montar({ apiKey: 'chave', modo: 'COBRANCA' });
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
    expect(leitura.requisicao).not.toHaveBeenCalled();
    expect(pix).toEqual({ gatewayId: 'pay_123', copiaECola: 'COPIA-E-COLA-REAL', qrCodeImagem: 'PNGBASE64', simulado: false });
  });

  it('não mexe no cadastro do cliente existente: reusa o id e não chama /customers', async () => {
    const { gateway, prisma } = montar({ apiKey: 'chave', modo: 'COBRANCA' });
    const rede = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'pay_1', status: 'PENDING' }) } as never);
    await gateway.criarPix(pedido);
    expect(rede.mock.calls.map((c) => c[0])).toEqual(['https://asaas.teste/v3/payments']);
    expect(prisma.db.titular.update).not.toHaveBeenCalled();
  });

  it('sem o código Pix, a cobrança recém-criada é removida e o erro sobe', async () => {
    const { gateway, leitura, asaas } = montar({ apiKey: 'chave', modo: 'COBRANCA' });
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'pay_9', status: 'PENDING' }) } as never);
    leitura.pixQrCode.mockRejectedValueOnce(new Error('QR indisponível'));
    const remover = jest.spyOn(asaas, 'removerCobranca').mockResolvedValue(true);
    await expect(gateway.criarPix(pedido)).rejects.toThrow('QR indisponível');
    expect(remover).toHaveBeenCalledWith('pay_9');
  });

  it('MEDIÇÃO: loga a duração total e a de cada chamada ao gateway, no sucesso e na falha', async () => {
    const { gateway, leitura, asaas } = montar({ apiKey: 'chave', modo: 'COBRANCA' });
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: 'pay_7', status: 'PENDING' }) } as never);
    const log = jest.spyOn((gateway as unknown as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation(() => undefined);
    await gateway.criarPix(pedido);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^criarPix intencao:int_abc \(107243c\) \[cobrança\]: ok em \d+ ms · cliente \d+ ms · POST \/payments \d+ ms · GET pixQrCode \d+ ms$/));

    leitura.pixQrCode.mockRejectedValueOnce(new Error('Asaas GET /payments/pay_7/pixQrCode não respondeu em 8 s'));
    jest.spyOn(asaas, 'removerCobranca').mockResolvedValue(true);
    await expect(gateway.criarPix(pedido)).rejects.toThrow('não respondeu em 8 s');
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/FALHOU \(Asaas GET .* não respondeu em 8 s\) em \d+ ms/));
  });

  it('Pix que NASCEU como cobrança é cancelado e consultado como cobrança, mesmo com o parâmetro já em ESTATICO', async () => {
    const paga = montar({ apiKey: 'chave', cobranca: { id: 'pay_1', status: 'RECEIVED', value: 600, clientPaymentDate: '2026-11-09' } });
    const removerPaga = jest.spyOn(paga.asaas, 'removerCobranca');
    expect(await paga.gateway.cancelarPix('pay_1')).toEqual({ cancelado: false, pago: true });
    expect(removerPaga).not.toHaveBeenCalled();
    expect(await paga.gateway.consultarPix('pay_1')).toEqual({ existe: true, pago: true, valor: 60000, dataPagamento: '2026-11-09', pagamentoId: 'pay_1' });
    expect(paga.leitura.requisicao).not.toHaveBeenCalled(); // nada de QR estático

    const pendente = montar({ apiKey: 'chave', cobranca: { id: 'pay_2', status: 'PENDING', value: 600 } });
    const remover = jest.spyOn(pendente.asaas, 'removerCobranca').mockResolvedValue(true);
    expect(await pendente.gateway.cancelarPix('pay_2')).toEqual({ cancelado: true, pago: false });
    expect(remover).toHaveBeenCalledWith('pay_2');

    const sumiu = montar({ apiKey: 'chave', cobranca: null });
    expect(await sumiu.gateway.cancelarPix('pay_3')).toEqual({ cancelado: true, pago: false });
  });
});
