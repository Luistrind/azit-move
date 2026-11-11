import type { FaturaPublica, SituacaoFaturaPublicaResumo } from '@azit/types';

// Fatura Azit — só as rotas PÚBLICAS (doc 02 §32.2). Sem token de sessão, sem
// cookies: o acesso é o token da fatura na URL.
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ErroFatura extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}/api/v1/publico/faturas${path}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) {
    let mensagem = 'Não foi possível carregar a fatura.';
    try {
      const j = (await r.json()) as { mensagem?: string };
      if (j?.mensagem) mensagem = j.mensagem;
    } catch {
      /* corpo não-JSON */
    }
    throw new ErroFatura(r.status, mensagem);
  }
  return (await r.json()) as T;
}

export const faturaApi = {
  fatura: (token: string) => get<FaturaPublica>(`/${token}`),
  situacao: (token: string) => get<SituacaoFaturaPublicaResumo>(`/${token}/situacao`),
  urlPdf: (token: string) => `${BASE}/api/v1/publico/faturas/${token}/pdf`,
};

// Token = caminho da URL (fatura.azitmove.com.br/<token>); também aceita ?t= para testes.
export function tokenDaUrl(): string | null {
  const caminho = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const t = caminho || new URLSearchParams(window.location.search).get('t') || '';
  return /^[a-f0-9]{64}$/.test(t) ? t : null;
}
