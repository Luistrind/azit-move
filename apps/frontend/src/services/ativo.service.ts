import { api } from '../lib/api';

// Cadastro/estoque de Ativo (Bloco 7 — tela de apoio). Valores em centavos.
export interface Ativo {
  varianteCatalogo?: string;
  id: string;
  tipo: string;
  descricao: string;
  marca: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  cor: string | null;
  placa: string | null;
  chassi: string | null;
  renavam: string | null;
  origem: string | null;
  combustivel: string | null;
  quilometragemEntrada: number | null;
  valorAquisicao: number | null;
  valorVenda: number | null;
  pacoteOfertaId: string | null;
  ofertaFixaId: string | null;
  // Estrutura jurídica DONA do ativo (tag — homologação 04/08); null nos legados.
  estruturaJuridica?: { id: string; nome: string } | null;
  status: string;
  // Controle de frota (doc 02 §25.1): anotação livre e cliente do contrato ativo.
  observacao: string | null;
  cliente: { id: string; nome: string; contratoId: string; contratoNumero: string } | null;
  // Reserva (doc 02 §31.4): preso a uma proposta aprovada da lista de espera.
  reserva?: { propostaId: string; titularNome: string; em: string } | null;
}

export interface CriarAtivoBody {
  // Obrigatória ao criar (homologação 04/08): estrutura jurídica dona do ativo.
  estruturaJuridicaId: string;
  varianteCatalogo?: string;
  descricao: string;
  marca?: string;
  modelo?: string;
  anoFabricacao?: number;
  anoModelo?: number;
  cor?: string;
  placa?: string;
  chassi?: string;
  renavam?: string;
  origem?: string;
  combustivel?: string;
  quilometragemEntrada?: number;
  valorAquisicao?: number;
  valorVenda?: number;
  pacoteOfertaId?: string;
  ofertaFixaId?: string | null;
}

export const ativoService = {
  async listar(params: { status?: string; placa?: string; chassi?: string; busca?: string; tipo?: 'veiculo' | 'outro' } = {}): Promise<{ total: number; data: Ativo[] }> {
    const { data } = await api.get('/api/v1/ativos', { params: { limit: 100, ...params } });
    return data;
  },
  async buscarPorId(id: string): Promise<Ativo> {
    const { data } = await api.get(`/api/v1/ativos/${id}`);
    return data;
  },
  async criar(body: CriarAtivoBody): Promise<Ativo> {
    const { data } = await api.post('/api/v1/ativos', body);
    return data;
  },
  async atualizar(id: string, body: Partial<CriarAtivoBody> & { observacao?: string | null }): Promise<Ativo> {
    const { data } = await api.patch(`/api/v1/ativos/${id}`, body);
    return data;
  },
  // Frota e ficha do veículo (doc 02 §25.7).
  async frota(params: { filtro?: FiltroFrota; busca?: string; offset?: number; limit?: number }): Promise<{ total: number; offset: number; limit: number; data: LinhaFrota[] }> {
    const { data } = await api.get('/api/v1/ativos/frota', { params });
    return data;
  },
  async frotaResumo(): Promise<ResumoFrota> {
    const { data } = await api.get<ResumoFrota>('/api/v1/ativos/frota/resumo');
    return data;
  },
  async ficha(id: string): Promise<FichaVeiculo> {
    const { data } = await api.get<FichaVeiculo>(`/api/v1/ativos/${id}/ficha`);
    return data;
  },
  // Central de documentos do veículo (Doc 2 §4.4-A).
  async documentos(ativoId: string): Promise<AtivoDocumento[]> {
    const { data } = await api.get<AtivoDocumento[]>(`/api/v1/ativos/${ativoId}/documentos`);
    return data;
  },
  async anexarDocumento(ativoId: string, body: { tipo: string; nome: string; conteudo: string }): Promise<AtivoDocumento[]> {
    const { data } = await api.post(`/api/v1/ativos/${ativoId}/documentos`, body);
    return data;
  },
  async removerDocumento(docId: string): Promise<AtivoDocumento[]> {
    const { data } = await api.delete(`/api/v1/ativos/documentos/${docId}`);
    return data;
  },
  async baixarDocumento(docId: string, nome: string): Promise<void> {
    const resp = await api.get(`/api/v1/ativos/documentos/${docId}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.click();
    URL.revokeObjectURL(url);
  },
};

export interface AtivoDocumento {
  id: string;
  tipo: string;
  nome: string;
  anexadoEm: string;
}

// ---------- Frota e ficha do veículo (doc 02 §25.7) ----------
export type FiltroFrota = 'disponivel' | 'reservado' | 'em_contrato' | 'transferido' | 'recuperado' | 'sinistrado' | 'com_pendencia';

export interface SituacaoDoVeiculo {
  situacao: string; // CONTA_SITUACAO_* (em_dia | em_atraso | em_acordo | bloqueada)
  diasAtraso: number;
  bloqueioDisponivel: boolean;
  bloqueadoEm: string | null;
}

export interface PendenciasDoVeiculo {
  quantidade: number;
  valor: number;
  proximoPrazo: { tipo: 'vencimento' | 'indicacao' | 'comprovante'; data: string } | null;
}

export interface RetornoDoVeiculo {
  investido: number;
  recebido: number;
  aReceber: number;
  percentual: number | null;
}

export interface LinhaFrota extends Ativo {
  contrato: ({ id: string; numero: string; contaId: string } & SituacaoDoVeiculo) | null;
  pendencias: PendenciasDoVeiculo;
  retorno: RetornoDoVeiculo;
}

export interface ResumoFrota {
  total: number;
  porStatus: Record<string, number>;
  comPendencia: { veiculos: number; ocorrencias: number; valor: number };
  investido: number;
  recebido: number;
  percentual: number | null;
}

export interface ContratoDoVeiculo {
  contratoId: string;
  numero: string;
  status: string;
  titular: string;
  titularId: string;
  contaId: string;
  inicio: string | null;
  fim: string | null;
  entradaPaga: number;
  parcelasPagas: number;
  emAberto: number;
}

export interface FichaVeiculo {
  ativo: Ativo & { ofertaFixa: { id: string; nome: string } | null; fipe: { modelo: string | null; referencia: string | null; consultadaEm: string | null } | null };
  comQuemEsta: ({ titular: { id: string; nome: string }; contrato: { id: string; numero: string; desde: string | null } } & SituacaoDoVeiculo) | null;
  pendencias: PendenciasDoVeiculo;
  retorno: RetornoDoVeiculo;
  observacao: { texto: string | null; alteradaEm: string | null; alteradaPor: string | null };
  custos: {
    aquisicao: number;
    cadastradoEm: string;
    custosExtras: number;
    totalInvestido: number;
    // orcado / repassadoAoCliente / contrato: custo da recuperação (doc 02 §29.3) — lançado na ficha do contrato.
    lancamentos: { id: string; tipo: string; descricao: string; valor: number; data: string; origem: { tipo: 'manual' | 'ocorrencia'; ocorrenciaId: string | null; rotulo: string } | null; orcado?: boolean; repassadoAoCliente?: boolean; contrato?: { id: string; numero: string } | null }[];
  };
  contratos: ContratoDoVeiculo[];
}
