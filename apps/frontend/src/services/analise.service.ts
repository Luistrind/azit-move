import { api } from '../lib/api';

// Análise de Cadastro F1 (Requisitos v0.2). Valores em centavos.
export interface ParticipanteAnalise {
  titularId: string; nome: string; papel: string;
  rendaDeclarada: number; rendaPresumida: number; rendaApurada: number | null;
  rendaParcialmenteComprovada: boolean; identidadeValidada: boolean; cnhValida: boolean;
  documentoAlternativo: boolean; atividadeComprovada: boolean; evidenciaAtividade: string | null;
  processosRelevantes: boolean; observacoes: string | null; autorizacaoRegistrada: boolean;
}
export interface CriterioAnalise {
  chave: string; titularId?: string; situacao: 'alcada' | 'complemento' | 'cocad';
  codigo?: string; valorObservado?: string; bloqueiaAprovacaoDireta: boolean;
  bloqueiaFormalizacao?: boolean; descricao: string;
}
export interface DossieAnalise {
  id: string; propostaId: string; status: string; politicaVersao: string;
  condutorPrincipalTitularId: string | null;
  parcelaMensalEquivalente: number; comprometimento: number | null;
  participantes: ParticipanteAnalise[];
  consultas: { id: string; titularId: string; tipo: string; fornecedor: string; protocolo: string | null; dataConsulta: string; situacao: string; motivoFalha: string | null; tentativas: number; resultado: Record<string, unknown> | null; valida: boolean }[];
  pendencias: { id: string; titularId: string | null; codigo: string; descricao: string; prazo: string | null; situacao: string }[];
  ressalvas: { id: string; tipo: string; condicao: string; prazo: string | null; situacao: string }[];
  alertasFraude: { id: string; nivel: string; descricao: string; resolvidoEm: string | null }[];
  criterios: CriterioAnalise[];
  aprovacaoDiretaPermitida: boolean; alcadaMinima: string;
  pacoteMinimo: { item: string; ok: boolean }[];
  transicoes: { de: string | null; para: string; motivo: string | null; createdAt: string }[];
}

export const analiseService = {
  async iniciar(propostaId: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/propostas/${propostaId}/analise`);
    return data;
  },
  async dossie(id: string): Promise<DossieAnalise> {
    const { data } = await api.get(`/api/v1/analises/${id}`);
    return data;
  },
  async porProposta(propostaId: string): Promise<DossieAnalise> {
    // iniciar é idempotente: devolve a existente
    return this.iniciar(propostaId);
  },
  async atualizarParticipante(id: string, titularId: string, body: Record<string, unknown>): Promise<DossieAnalise> {
    const { data } = await api.patch(`/api/v1/analises/${id}/participantes/${titularId}`, body);
    return data;
  },
  async definirCondutor(id: string, titularId: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/condutor/${titularId}`);
    return data;
  },
  async registrarAutorizacao(id: string, titularId: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/autorizacoes/${titularId}`, {});
    return data;
  },
  async registrarConsulta(id: string, body: Record<string, unknown>): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/consultas`, body);
    return data;
  },
  async criarPendencia(id: string, body: { titularId?: string; codigo: string; descricao: string }): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/pendencias`, body);
    return data;
  },
  async cumprirPendencia(id: string, pendenciaId: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/pendencias/${pendenciaId}/cumprir`);
    return data;
  },
  async transicionar(id: string, para: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/transicao`, { para });
    return data;
  },
  async emitirParecer(id: string, body: { tipo: string; texto: string; codigos: string[] }): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/parecer`, body);
    return data;
  },
  async aprovar(id: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/aprovar`);
    return data;
  },
  async submeterCocad(id: string, recomendacao: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/cocad`, { recomendacao });
    return data;
  },
  async aprovarComRessalvas(id: string, ressalvas: { tipo: string; condicao: string }[]): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/cocad/ressalvas`, { ressalvas });
    return data;
  },
  async validarRessalva(id: string, ressalvaId: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/ressalvas/${ressalvaId}/validar`, {});
    return data;
  },
  async naoAprovar(id: string, codigo: string, justificativa: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/nao-aprovar`, { codigo, justificativa });
    return data;
  },
  async encerrar(id: string, motivo: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/encerrar`, { motivo });
    return data;
  },
  async liberar(id: string): Promise<DossieAnalise> {
    const { data } = await api.post(`/api/v1/analises/${id}/liberar`);
    return data;
  },
};
