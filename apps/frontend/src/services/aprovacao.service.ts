import { api } from '../lib/api';

// Motor de aprovação unificado (Doc 2 §7.9-A). Valores em CENTAVOS.
export interface DecisaoTrilha {
  usuarioId: string;
  usuario: string;
  decisao: 'APROVADA' | 'RECOMENDADA' | 'REPROVADA';
  parecer: string | null;
  em: string;
}

export interface ContextoTitular {
  contratosAtivos: number;
  saldoDevedor: number;
  valorEmAtraso: number;
  faturasVencidas: number;
}

export interface Aprovacao {
  id: string;
  tipoOperacao: string;
  tipoOperacaoNome: string;
  resumo: string;
  valor: number;
  status: 'PENDENTE' | 'APROVADA' | 'REPROVADA' | 'CANCELADA';
  solicitanteId: string;
  solicitante: string;
  solicitadoEm: string;
  aprovacoesNecessarias: number;
  aprovacoesFeitas: number;
  decisoes: DecisaoTrilha[];
  titular: { id: string; nome: string } | null;
  contexto: ContextoTitular | null;
  // Situação do usuário logado frente a esta solicitação (calculada no backend).
  minha: { podeAprovar: boolean; ehSolicitante: boolean; jaDecidiu: boolean };
}

export type DecisaoInput = 'aprovar' | 'recomendar' | 'reprovar';

export const aprovacaoService = {
  async pendentes(): Promise<Aprovacao[]> {
    const { data } = await api.get<Aprovacao[]>('/api/v1/aprovacoes/pendentes');
    return data;
  },
  async historico(): Promise<Aprovacao[]> {
    const { data } = await api.get<Aprovacao[]>('/api/v1/aprovacoes/historico');
    return data;
  },
  async contagem(): Promise<number> {
    const { data } = await api.get<{ pendentes: number }>('/api/v1/aprovacoes/contagem');
    return data.pendentes;
  },
  async decidir(
    id: string,
    decisao: DecisaoInput,
    parecer?: string,
  ): Promise<{ status: string; efetivada: boolean; mensagem?: string }> {
    const { data } = await api.post(`/api/v1/aprovacoes/${id}/decidir`, { decisao, parecer });
    return data;
  },
};
