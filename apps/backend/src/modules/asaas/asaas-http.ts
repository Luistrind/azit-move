// Chamada HTTP ao Asaas com TEMPO LIMITE (15/11/2026). Antes o `fetch` não tinha
// limite: se o Asaas demorasse, a requisição de quem esperava (ex.: o cliente
// pedindo o Pix na página da fatura) ficava pendurada sem resposta. Agora cada
// chamada desiste depois de ASAAS_TIMEOUT_MS e sobe um erro claro — a página já
// tem a tela "Não conseguimos gerar o Pix agora", e os jobs de fila repetem.

export const ASAAS_TIMEOUT_MS = 8_000;

// Limite PRÓPRIO da consulta do código Pix (GET /payments/{id}/pixQrCode),
// ajustável por ambiente em ASAAS_PIX_QR_TIMEOUT_MS. Homologação 15/11: no
// sandbox a cobrança nasce em ~0,7 s, mas o código Pix não veio em 8 s — o
// homolog usa um limite maior para MEDIR quanto o sandbox leva; produção fica
// no padrão (8 s) até a medição dizer outra coisa. Valor inválido = padrão.
export function limiteQrPixMs(): number {
  const n = Number(process.env.ASAAS_PIX_QR_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1_000 && n <= 60_000 ? Math.round(n) : ASAAS_TIMEOUT_MS;
}

export class AsaasTimeoutError extends Error {
  constructor(rotulo: string, limiteMs: number = ASAAS_TIMEOUT_MS) {
    super(`Asaas ${rotulo} não respondeu em ${limiteMs / 1000} s`);
    this.name = 'AsaasTimeoutError';
  }
}

// `rotulo` = "POST /payments", "GET /payments/{id}/pixQrCode"… (vai para o erro e o log).
export async function fetchAsaas(url: string, init: RequestInit, rotulo: string, limiteMs: number = ASAAS_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(limiteMs) });
  } catch (e) {
    const nome = (e as { name?: string } | null)?.name;
    if (nome === 'TimeoutError' || nome === 'AbortError') throw new AsaasTimeoutError(rotulo, limiteMs);
    throw e;
  }
}

// Leitura do corpo também respeita o limite (o sinal aborta o stream): traduz o erro.
export async function corpoJson<T>(resp: Response, rotulo: string, limiteMs: number = ASAAS_TIMEOUT_MS): Promise<T> {
  try {
    return (await resp.json()) as T;
  } catch (e) {
    const nome = (e as { name?: string } | null)?.name;
    if (nome === 'TimeoutError' || nome === 'AbortError') throw new AsaasTimeoutError(rotulo, limiteMs);
    throw e;
  }
}
