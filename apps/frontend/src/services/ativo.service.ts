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
  // Preparação aberta (doc 02 §25.8): o que falta — alimenta o alerta "Veículo em preparação".
  preparacao?: AlertaPreparacao | null;
}

// ---------- Preparação do veículo (doc 02 §25.8) ----------
export interface AlertaPreparacao {
  preparacaoId: string;
  oQueFalta: string | null;
  pendentes: string[];
  totalItens: number;
  abertaEm: string;
  motivo?: string; // texto do bloqueio da formalização (proposta / análise)
}

export interface ItemPreparacao {
  id: string;
  descricao: string;
  avulso: boolean;
  situacao: 'feito' | 'nao_se_aplica' | null;
  marcadoEm: string | null;
  marcadoPor: string | null;
}

export interface Preparacao {
  id: string;
  motivo: 'entrada' | 'recuperacao' | 'manutencao';
  oQueFalta: string | null;
  abertaEm: string;
  abertaPor: string | null;
  concluidaEm: string | null;
  concluidaPor: string | null;
  itens: ItemPreparacao[];
  pendentes: number;
}

export interface PreparacoesDoVeiculo {
  aberta: Preparacao | null;
  anteriores: Preparacao[];
}

export interface ItemModeloChecklist {
  id?: string;
  descricao: string;
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
  async listar(params: { status?: string; oferecivel?: 'true'; placa?: string; chassi?: string; busca?: string; tipo?: 'veiculo' | 'outro' } = {}): Promise<{ total: number; data: Ativo[] }> {
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
  // Preparação para venda (doc 02 §25.8).
  async preparacao(ativoId: string): Promise<PreparacoesDoVeiculo> {
    const { data } = await api.get<PreparacoesDoVeiculo>(`/api/v1/ativos/${ativoId}/preparacao`);
    return data;
  },
  async liberarParaVenda(ativoId: string, oQueFalta?: string): Promise<PreparacoesDoVeiculo> {
    const { data } = await api.post<PreparacoesDoVeiculo>(`/api/v1/ativos/${ativoId}/liberar-para-venda`, { oQueFalta: oQueFalta || undefined });
    return data;
  },
  async enviarParaPreparacao(ativoId: string, oQueFalta?: string): Promise<PreparacoesDoVeiculo> {
    const { data } = await api.post<PreparacoesDoVeiculo>(`/api/v1/ativos/${ativoId}/preparacao`, { oQueFalta: oQueFalta || undefined });
    return data;
  },
  async incluirItemPreparacao(ativoId: string, descricao: string): Promise<PreparacoesDoVeiculo> {
    const { data } = await api.post<PreparacoesDoVeiculo>(`/api/v1/ativos/${ativoId}/preparacao/itens`, { descricao });
    return data;
  },
  async marcarItemPreparacao(itemId: string, situacao: ItemPreparacao['situacao']): Promise<PreparacoesDoVeiculo> {
    const { data } = await api.patch<PreparacoesDoVeiculo>(`/api/v1/ativos/preparacao/itens/${itemId}`, { situacao });
    return data;
  },
  async removerItemPreparacao(itemId: string): Promise<PreparacoesDoVeiculo> {
    const { data } = await api.delete<PreparacoesDoVeiculo>(`/api/v1/ativos/preparacao/itens/${itemId}`);
    return data;
  },
  async concluirPreparacao(ativoId: string): Promise<PreparacoesDoVeiculo> {
    const { data } = await api.post<PreparacoesDoVeiculo>(`/api/v1/ativos/${ativoId}/preparacao/concluir`);
    return data;
  },
  async modeloChecklist(): Promise<ItemModeloChecklist[]> {
    const { data } = await api.get<ItemModeloChecklist[]>('/api/v1/ativos/preparacao/modelo');
    return data;
  },
  async salvarModeloChecklist(itens: ItemModeloChecklist[]): Promise<ItemModeloChecklist[]> {
    const { data } = await api.put<ItemModeloChecklist[]>('/api/v1/ativos/preparacao/modelo', { itens });
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
export type FiltroFrota = 'disponivel' | 'em_preparacao' | 'reservado' | 'em_contrato' | 'transferido' | 'recuperado' | 'sinistrado' | 'com_pendencia';

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
  // Preparação para venda (doc 02 §25.8): a aberta com o checklist e o histórico.
  preparacao: PreparacoesDoVeiculo;
}
