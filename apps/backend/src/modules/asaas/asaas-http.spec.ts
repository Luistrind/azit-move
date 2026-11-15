import { ASAAS_TIMEOUT_MS, AsaasTimeoutError, fetchAsaas, limiteQrPixMs } from './asaas-http';
import { AsaasService } from './asaas.service';
import { AsaasLeituraService } from './asaas-leitura.service';

// Tempo limite das chamadas ao Asaas (15/11/2026): antes o fetch não tinha
// limite e uma chamada pendurada segurava quem esperava (o cliente pedindo o
// Pix). Agora desiste em ~8 s com um erro que diz o que não respondeu.

const integracoes = { asaas: () => ({ apiKey: 'chave', apiUrl: 'https://asaas.teste/v3', webhookSecret: '', ambiente: 'sandbox', fonte: 'env' }) };
const estouro = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

describe('fetchAsaas — tempo limite', () => {
  afterEach(() => jest.restoreAllMocks());

  it('toda chamada sai com um sinal de aborto de 8 s', async () => {
    const limite = jest.spyOn(AbortSignal, 'timeout');
    const rede = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as never);
    await fetchAsaas('https://asaas.teste/v3/payments', { method: 'POST' }, 'POST /payments');
    expect(ASAAS_TIMEOUT_MS).toBe(8000);
    expect(limite).toHaveBeenCalledWith(8000);
    expect((rede.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('estouro do tempo vira erro claro, com o nome da chamada; outros erros de rede passam como são', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(estouro());
    await expect(fetchAsaas('https://x', {}, 'POST /payments')).rejects.toThrow(new AsaasTimeoutError('POST /payments'));
    await expect(Promise.reject(new AsaasTimeoutError('POST /payments'))).rejects.toThrow('Asaas POST /payments não respondeu em 8 s');
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(fetchAsaas('https://x', {}, 'POST /payments')).rejects.toThrow('ECONNREFUSED');
  });

  it('AsaasService.criarCobranca: Asaas pendurado → erro de tempo limite (a rota do Pix responde 503 em vez de ficar esperando)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(estouro());
    const asaas = new AsaasService(integracoes as never);
    await expect(asaas.criarCobranca({ externalReference: 'intencao:int_1', valor: 1000, vencimento: new Date('2026-11-09T00:00:00Z'), descricao: 'x', customerId: 'cus_1' })).rejects.toThrow('Asaas POST /payments não respondeu em 8 s');
  });

  it('AsaasLeituraService.pixQrCode: tempo limite com erro claro, e limite de requisições (429) NÃO dorme 30 s com o cliente esperando', async () => {
    const leitura = new AsaasLeituraService(integracoes as never);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(estouro());
    await expect(leitura.pixQrCode('pay_1')).rejects.toThrow('Asaas GET /payments/pay_1/pixQrCode não respondeu em 8 s');

    const rede = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 429, text: async () => 'limite de requisições' } as never);
    rede.mockClear(); // zera a chamada do estouro acima (é o mesmo espião)
    const t0 = Date.now();
    await expect(leitura.pixQrCode('pay_1')).rejects.toMatchObject({ status: 429 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(rede).toHaveBeenCalledTimes(1); // sem repetição
  });
});

// Limite próprio do código Pix (homolog 15/11): o sandbox não devolveu o código
// em 8 s; o homolog aumenta o limite por ambiente para medir, produção fica em 8 s.
describe("limite da consulta do código Pix (ASAAS_PIX_QR_TIMEOUT_MS)", () => {
  const antes = process.env.ASAAS_PIX_QR_TIMEOUT_MS;
  afterEach(() => {
    if (antes === undefined) delete process.env.ASAAS_PIX_QR_TIMEOUT_MS;
    else process.env.ASAAS_PIX_QR_TIMEOUT_MS = antes;
    jest.restoreAllMocks();
  });

  it("sem a variável (ou com valor fora de 1–60 s) fica no padrão de 8 s", () => {
    delete process.env.ASAAS_PIX_QR_TIMEOUT_MS;
    expect(limiteQrPixMs()).toBe(8000);
    for (const v of ["abc", "500", "120000", ""]) {
      process.env.ASAAS_PIX_QR_TIMEOUT_MS = v;
      expect(limiteQrPixMs()).toBe(8000);
    }
  });

  it("com a variável, SÓ o pixQrCode usa o limite novo; as outras chamadas seguem em 8 s", async () => {
    process.env.ASAAS_PIX_QR_TIMEOUT_MS = "30000";
    const limite = jest.spyOn(AbortSignal, "timeout");
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ payload: "000201", id: "pay_1" }) } as never);
    const leitura = new AsaasLeituraService(integracoes as never);
    await leitura.pixQrCode("pay_1");
    expect(limite).toHaveBeenLastCalledWith(30000);
    const asaas = new AsaasService(integracoes as never);
    await asaas.criarCobranca({ externalReference: "intencao:int_1", valor: 1000, vencimento: new Date("2026-11-09T00:00:00Z"), descricao: "x", customerId: "cus_1" }).catch(() => undefined);
    expect(limite).toHaveBeenLastCalledWith(8000);
  });

  it("estouro do limite próprio diz o tempo certo no erro", async () => {
    process.env.ASAAS_PIX_QR_TIMEOUT_MS = "30000";
    jest.spyOn(global, "fetch").mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const leitura = new AsaasLeituraService(integracoes as never);
    await expect(leitura.pixQrCode("pay_1")).rejects.toThrow("Asaas GET /payments/pay_1/pixQrCode não respondeu em 30 s");
  });
});
