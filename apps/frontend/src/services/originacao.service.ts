import { api } from '../lib/api';

// Bloco 7 — funil de originação nativa. Valores em centavos.
export interface AtivoDisponivel {
  id: string;
  descricao: string;
  placa: string | null;
  valorVenda: number | null;
  pacoteOfertaId: string | null;
}

// Simulação V3 (Doc 2 §4-A.2): prazo em MESES + frequência; ofertas fixas/padrão/
// personalizadas. Visão comercial — sem termos internos (CI/CR/TR).
export interface OfertaSimulada {
  id: string;
  tipo: 'oferta_fixa' | 'padrao' | 'personalizada';
  valorEntrada: number;
  entradaParcelada: boolean;
  prazoMeses: number | null;
  frequencia: 'mensal' | 'quinzenal' | 'semanal';
  valorParcela: number;
  numeroParcelas: number;
  selecionada: boolean;
}

export interface SimulacaoResultado {
  id: string;
  status: string;
  validaAte: string | null;
  leadId?: string | null;
  cliente?: { nome: string; cpf: string; telefone: string | null; titularId: string | null } | null;
  propostaId?: string | null;
  ativo: { id: string; descricao: string; placa: string | null } | null;
  valorAvista: number;
  valorAvistaManual: boolean;
  avisoDivergencia: string | null;
  ofertas: OfertaSimulada[];
}

export interface PropostaResumo {
  id: string;
  status: string;
  modalidade: string;
  titular: string;
  ativo: string;
  valorEntrada: number;
  valorParcela: number;
  numeroParcelas: number;
  prazoSemanas: number;
  contratoGeradoId: string | null;
  createdAt: string;
}

export interface PropostaDetalhe {
  id: string;
  status: string;
  modalidade: string;
  ativo: { id: string; descricao: string };
  titular: { id: string; nome: string; cpfCnpj: string; whatsapp: string };
  valorEntrada: number;
  valorParcela: number;
  numeroParcelas: number;
  prazoSemanas: number;
  contratoGeradoId: string | null;
  papeis: { id: string; papel: string; titular: { id: string; nome: string; cpfCnpj: string } }[];
  documentos: { id: string; tipo: string; titularId: string; arquivoRef: string }[];
  parecer: { resultado: string; exigeGarantidor: boolean; motivoReprovacao: string | null } | null;
  documentosObrigatorios: string[];
  pendenciasDocumentos: { titularId: string; papel: string; nome: string; faltando: string[] }[];
  documentosCompletos: boolean;
  itens: { id: string; produtoId: string | null; nome: string; natureza: string; apartado: boolean; credor: string; valor: number; periodicidade: string | null }[];
}

export interface Cadastro {
  nome: string;
  tipoPessoa?: 'pf' | 'pj';
  cpfCnpj: string;
  whatsapp: string;
  email?: string;
  rg?: string;
  estadoCivil?: string;
  profissao?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
}

export interface SimulacaoResumo {
  id: string;
  cliente: string;
  ativo: string;
  valorAvista: number;
  valorEntrada: number;
  status: string;
  validaAte: string | null;
  ofertaEscolhida: {
    valorParcela: number;
    numeroParcelas: number;
    frequencia: string;
    prazoMeses: number | null;
  } | null;
  propostaId: string | null;
  propostaStatus: string | null;
}

export const originacaoService = {
  async ativosDisponiveis(): Promise<AtivoDisponivel[]> {
    const { data } = await api.get('/api/v1/ativos', { params: { status: 'disponivel', limit: 100 } });
    return data.data;
  },
  async criarLead(body: { nome: string; cpf: string; telefone: string; canalOrigem: string }): Promise<{ tipo: string; lead?: { id: string }; titular?: { nome: string } }> {
    const { data } = await api.post('/api/v1/leads', body);
    return data;
  },
  async detalheSimulacao(id: string): Promise<SimulacaoResultado> {
    const { data } = await api.get<SimulacaoResultado>(`/api/v1/simulacoes/${id}`);
    return data;
  },
  async simular(body: { ativoId?: string; valorAvista?: number; leadId?: string }): Promise<SimulacaoResultado> {
    const { data } = await api.post('/api/v1/simulacoes', body);
    return data;
  },
  // Tela 3 — cenário personalizado (bloqueios de entrada/prazo no backend).
  async simularOpcao(
    simulacaoId: string,
    body: {
      valorEntrada: number;
      prazoMeses: number;
      frequencia: 'mensal' | 'quinzenal' | 'semanal';
      entradaParcelada?: boolean;
    },
  ): Promise<SimulacaoResultado> {
    const { data } = await api.post(`/api/v1/simulacoes/${simulacaoId}/opcoes`, body);
    return data;
  },
  async apresentarSimulacao(simulacaoId: string): Promise<void> {
    await api.post(`/api/v1/simulacoes/${simulacaoId}/apresentar`);
  },
  async selecionarOferta(simulacaoId: string, ofertaId: string): Promise<void> {
    await api.post(`/api/v1/simulacoes/${simulacaoId}/selecionar`, { ofertaId });
  },
  async criarProposta(body: { simulacaoId: string; modalidade?: string; comprador?: Cadastro }): Promise<PropostaDetalhe> {
    const { data } = await api.post('/api/v1/propostas', body);
    return data;
  },
  async listarPropostas(): Promise<PropostaResumo[]> {
    const { data } = await api.get('/api/v1/propostas');
    return data;
  },
  async listarSimulacoes(): Promise<SimulacaoResumo[]> {
    const { data } = await api.get('/api/v1/simulacoes');
    return data;
  },
  async detalheProposta(id: string): Promise<PropostaDetalhe> {
    const { data } = await api.get(`/api/v1/propostas/${id}`);
    return data;
  },
  async patchStatus(id: string, status: string): Promise<PropostaDetalhe> {
    const { data } = await api.patch(`/api/v1/propostas/${id}/status`, { status });
    return data;
  },
  async adicionarVinculo(id: string, papel: string, titular: Cadastro): Promise<PropostaDetalhe> {
    const { data } = await api.post(`/api/v1/propostas/${id}/vinculos`, { papel, titular });
    return data;
  },
  async adicionarProduto(id: string, produtoId: string): Promise<PropostaDetalhe> {
    const { data } = await api.post(`/api/v1/propostas/${id}/produtos`, { produtoId });
    return data;
  },
  async removerProduto(id: string, itemId: string): Promise<PropostaDetalhe> {
    const { data } = await api.delete(`/api/v1/propostas/${id}/produtos/${itemId}`);
    return data;
  },
  async anexarDocumento(id: string, titularId: string, tipo: string, arquivo?: { nome: string; conteudo: string }): Promise<PropostaDetalhe> {
    const { data } = await api.post(`/api/v1/propostas/${id}/documentos`, {
      titularId, tipo, arquivoNome: arquivo?.nome, arquivoConteudo: arquivo?.conteudo,
    });
    return data;
  },
  async baixarDocumento(docId: string, nome: string): Promise<void> {
    const resp = await api.get(`/api/v1/propostas/documentos/${docId}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.click();
    URL.revokeObjectURL(url);
  },
  async registrarParecer(id: string, body: { resultado: string; motivoReprovacao?: string; exigeGarantidor?: boolean }): Promise<PropostaDetalhe> {
    const { data } = await api.post(`/api/v1/propostas/${id}/parecer`, body);
    return data;
  },
  async formalizar(id: string): Promise<{ contratoId: string; numero: string; status: string; documento: string }> {
    const { data } = await api.post(`/api/v1/propostas/${id}/formalizar`, {});
    return data;
  },
  async statusContrato(contratoId: string): Promise<{
    status: string; numero: string; entrada: number; entradaAVista: number; entradaParcelada: boolean;
    assinadoTitular: boolean; assinadoAzit: boolean; ambasAssinaturas: boolean; cronogramaGerado: boolean;
  }> {
    const { data } = await api.get(`/api/v1/contratos/${contratoId}/status-formalizacao`);
    return data;
  },
  async statusPacote(propostaId: string): Promise<{
    propostaId: string; ancoraId: string | null; entrada: number; entradaAVista: number; entradaParcelada: boolean;
    todasAssinaturas: boolean; cronogramaGerado: boolean;
    contratos: { id: string; numero: string; descricao: string; status: string; entrada: number; entradaAVista: number; entradaParcelada: boolean; ancora: boolean; assinadoTitular: boolean; assinadoAzit: boolean; ambasAssinaturas: boolean; cronogramaGerado: boolean }[];
  }> {
    const { data } = await api.get(`/api/v1/propostas/${propostaId}/status-pacote`);
    return data;
  },
  async assinar(contratoId: string, parte: 'titular' | 'azit'): Promise<unknown> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/assinar`, { parte });
    return data;
  },
  async ativar(contratoId: string): Promise<{ status: string; entrada: number; entradaAVista: number; cobranca: { id: string } }> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/ativar`, {});
    return data;
  },
  async simularPagamentoAtivacao(contratoId: string): Promise<{ status: string }> {
    const { data } = await api.post(`/api/v1/dev/simular-pagamento-ativacao/${contratoId}`, {});
    return data;
  },
};
