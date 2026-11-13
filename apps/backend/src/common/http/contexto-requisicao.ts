// IP e agente de uma requisição, para o registro de acessos (doc 06 §2.5) e o
// limite por IP (§11.3). Atrás do Traefik/Swarm o IP real vem em
// X-Forwarded-For; o FastifyAdapter sobe com `trustProxy: true` (main.ts), então
// `req.ip` já é o do cliente — o cabeçalho fica só como reserva.
export interface ContextoRequisicao {
  ip: string | null;
  agente: string | null;
}

// Tipo estrutural (não importa `fastify`, que não é dependência direta do backend).
export interface RequisicaoComOrigem {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

export function contextoRequisicao(req: RequisicaoComOrigem): ContextoRequisicao {
  const encaminhado = req.headers['x-forwarded-for'];
  const primeiroEncaminhado = (Array.isArray(encaminhado) ? encaminhado[0] : encaminhado)?.split(',')[0]?.trim();
  const agente = req.headers['user-agent'];
  return {
    ip: req.ip || primeiroEncaminhado || null,
    agente: (Array.isArray(agente) ? agente[0] : agente)?.slice(0, 300) ?? null,
  };
}
