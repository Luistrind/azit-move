// Chamada HTTP ao Asaas com TEMPO LIMITE (15/11/2026). Antes o `fetch` não tinha
// limite: se o Asaas demorasse, a requisição de quem esperava (ex.: o cliente
// pedindo o Pix na página da fatura) ficava pendurada sem resposta. Agora cada
// chamada desiste depois de ASAAS_TIMEOUT_MS e sobe um erro claro — a página já
// tem a tela "Não conseguimos gerar o Pix agora", e os jobs de fila repetem.

export const ASAAS_TIMEOUT_MS = 8_000;

export class AsaasTimeoutError extends Error {
  constructor(rotulo: string) {
    super(`Asaas ${rotulo} não respondeu em ${ASAAS_TIMEOUT_MS / 1000} s`);
    this.name = 'AsaasTimeoutError';
  }
}

// `rotulo` = "POST /payments", "GET /payments/{id}/pixQrCode"… (vai para o erro e o log).
export async function fetchAsaas(url: string, init: RequestInit, rotulo: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ASAAS_TIMEOUT_MS) });
  } catch (e) {
    const nome = (e as { name?: string } | null)?.name;
    if (nome === 'TimeoutError' || nome === 'AbortError') throw new AsaasTimeoutError(rotulo);
    throw e;
  }
}

// Leitura do corpo também respeita o limite (o sinal aborta o stream): traduz o erro.
export async function corpoJson<T>(resp: Response, rotulo: string): Promise<T> {
  try {
    return (await resp.json()) as T;
  } catch (e) {
    const nome = (e as { name?: string } | null)?.name;
    if (nome === 'TimeoutError' || nome === 'AbortError') throw new AsaasTimeoutError(rotulo);
    throw e;
  }
}
