import type { FaturaPublica, PixSobDemandaPublico, SituacaoFaturaPublicaResumo } from '@azit/types';

// Fatura Azit — só as rotas PÚBLICAS (doc 02 §32.2). Sem token de sessão, sem
// cookies: o acesso é o token da fatura na URL.
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ErroFatura extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
    // Código do erro da API (ex.: valor_invalido, limite_pix_dia, pix_indisponivel).
    public readonly codigo: string | null = null,
    // WhatsApp da Azit, quando a API manda junto do erro (link inválido).
    public readonly atendimento: { texto: string | null; link: string | null } | null = null,
  ) {
    super(mensagem);
  }
}

async function chamar<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/v1/publico/faturas${path}`, { cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let mensagem = 'Não foi possível carregar a fatura.';
    let codigo: string | null = null;
    let atendimento: { texto: string | null; link: string | null } | null = null;
    try {
      const j = (await r.json()) as { mensagem?: string; erro?: string; atendimentoWhatsapp?: string | null; atendimentoWhatsappLink?: string | null };
      if (j?.mensagem) mensagem = j.mensagem;
      if (j?.erro) codigo = j.erro;
      if (j?.atendimentoWhatsappLink) atendimento = { texto: j.atendimentoWhatsapp ?? null, link: j.atendimentoWhatsappLink };
    } catch {
      /* corpo não-JSON */
    }
    throw new ErroFatura(r.status, mensagem, codigo, atendimento);
  }
  return (await r.json()) as T;
}

export const faturaApi = {
  fatura: (token: string) => chamar<FaturaPublica>(`/${token}`),
  situacao: (token: string) => chamar<SituacaoFaturaPublicaResumo>(`/${token}/situacao`),
  // Pix sob demanda (doc 02 §32.4-A): pede o Pix do valor escolhido (centavos).
  // O servidor valida o valor e devolve o código — ou o que já estava ativo.
  criarIntencao: (token: string, valor: number) =>
    chamar<PixSobDemandaPublico>(`/${token}/intencao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) }),
  // PDF da fatura do link ou, com `numero`, de outra fatura da mesma conta.
  urlPdf: (token: string, numero?: number) => `${BASE}/api/v1/publico/faturas/${token}/pdf${numero ? `?fatura=${numero}` : ''}`,
};

// Token = caminho da URL (fatura.azitmove.com.br/<token>); também aceita ?t= para testes.
export function tokenDaUrl(): string | null {
  const caminho = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const t = caminho || new URLSearchParams(window.location.search).get('t') || '';
  return /^[a-f0-9]{64}$/.test(t) ? t : null;
}
