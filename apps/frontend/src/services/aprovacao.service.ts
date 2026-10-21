import { api } from '../lib/api';
import type { DecisaoAprovacao, StatusAprovacao, VezAprovacao } from '@azit/types';

// Motor de aprovação unificado (Doc 2 §7.9-A). Valores em CENTAVOS.
export interface DecisaoTrilha {
  usuarioId: string;
  usuario: string;
  decisao: `${DecisaoAprovacao}`;
  parecer: string | null;
  em: string;
}

export interface ContextoTitular {
  contratosAtivos: number;
  saldoDevedor: number;
  valorEmAtraso: number;
  faturasVencidas: number;
}

// Pedir complemento (doc 02 §7.9-A, decisão Luís 21/10): pergunta de quem
// decide, resposta de quem solicitou. Sem prazo. Não é voto.
export interface ComplementoAprovacao {
  id: string;
  pergunta: string;
  pedidoPor: string;
  pedidoPorId: string;
  pedidoEm: string;
  resposta: string | null;
  respondidoPor: string | null;
  respondidoEm: string | null;
}

export interface Aprovacao {
  id: string;
  tipoOperacao: string;
  tipoOperacaoNome: string;
  resumo: string;
  // Motivos por extenso (payload das novas; a tela traduz códigos das antigas).
  motivos: string[];
  valor: number;
  status: `${StatusAprovacao}`;
  solicitanteId: string;
  solicitante: string;
  solicitadoEm: string;
  aprovacoesNecessarias: number;
  aprovacoesFeitas: number;
  aprovacoesFaltando: number;
  decisoes: DecisaoTrilha[];
  titular: { id: string; nome: string } | null;
  // Com quem é a operação: titular ou, no contas a pagar, o fornecedor/lote.
  contraparte: { tipo: 'titular' | 'fornecedor' | 'lote'; id: string | null; nome: string } | null;
  complementos: ComplementoAprovacao[];
  complementoAberto: ComplementoAprovacao | null;
  contexto: ContextoTitular | null;
  // Contexto de ANÁLISE DE CADASTRO (COCAD) — proposta nova não tem conta.
  contextoAnalise: {
    analiseId: string;
    propostaId: string;
    ativo: string;
    valorParcela: number;
    frequencia: string | null;
    rendaDeclarada: number | null;
    rendaPresumida: number | null;
    rendaApurada: number | null;
    // Parecer do analista — o que o Comitê está aprovando ou não.
    parecer: { texto: string; tipo: string | null; emitidoPor: string; emitidoEm: string } | null;
    // Veículo da proposta (14/10): quilometragem, ano e quantos contratos o carro já teve.
    veiculo: { quilometragem: number | null; ano: string | null; contratosAnteriores: number } | null;
  } | null;
  // Situação do usuário logado frente a esta solicitação (calculada no backend).
  minha: { podeAprovar: boolean; ehSolicitante: boolean; jaDecidiu: boolean; vez: `${VezAprovacao}` | null };
}

// Bloco genérico do dossiê (tipos sem detalhe próprio): rótulo/valor já em texto.
export interface BlocoDossie {
  titulo: string;
  campos?: { rotulo: string; valor: string; tom?: 'alerta' | 'atencao' | 'ok' }[];
  tabela?: { colunas: string[]; direita?: number[]; linhas: { celulas: string[]; destaque?: boolean }[] };
  nota?: string;
}

// Histórico de recuperação e contexto da conta (calculado na leitura).
export interface ContextoContaDossie {
  contaId: string;
  clienteDesde: string;
  contratos: {
    id: string;
    numero: string;
    descricao: string;
    placa: string | null;
    periodicidade: string;
    parcelasPagas: number;
    numeroParcelas: number;
    ultimoVencimento: string | null;
    veiculoBloqueadoEm: string | null;
    recuperacaoIniciadaEm: string | null;
  }[];
  acordos: { id: string; status: string; criadoEm: string; plano: string; cotas: number; cotasPagas: number }[];
  ordemAcordo: number | null;
  acordosEmAberto: number;
  novacoes: { id: string; status: string; criadaEm: string }[];
  proximaFatura: { numero: number; dataVencimento: string; valorTotal: number } | null;
  renda: { apurada: number; analiseEm: string } | null;
  comprometimento: {
    frequencia: string;
    atual: number | null;
    comOperacao: number | null;
    valorComOperacao: number | null;
    limitePolitica: number | null;
  } | null;
}

export interface AprovacaoDossie extends Aprovacao {
  detalhe: {
    tipo: string;
    referenciaId: string;
    observacao: { autor: string | null; em: string | null; texto: string } | null;
    blocos: BlocoDossie[];
    conta: ContextoContaDossie | null;
  } | null;
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
  // Dossiê (21/10): o item da lista + o detalhe por tipo.
  async obter(id: string): Promise<AprovacaoDossie> {
    const { data } = await api.get<AprovacaoDossie>(`/api/v1/aprovacoes/${id}`);
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
  async pedirComplemento(id: string, pergunta: string): Promise<{ id: string }> {
    const { data } = await api.post(`/api/v1/aprovacoes/${id}/complemento`, { pergunta });
    return data;
  },
  async responderComplemento(id: string, resposta: string): Promise<void> {
    await api.post(`/api/v1/aprovacoes/${id}/complemento/responder`, { resposta });
  },
};
