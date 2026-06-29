import { api } from '../lib/api';

// Bloco 7 — funil de originação nativa. Valores em centavos.
export interface AtivoDisponivel {
  id: string;
  descricao: string;
  placa: string | null;
  valorVenda: number | null;
  pacoteOfertaId: string | null;
}

export interface OfertaSimulada {
  id: string;
  origemCalculo: string;
  valorEntrada: number;
  prazoSemanas: number;
  valorParcela: number;
  numeroParcelas: number;
  valorFinanciado: number;
  totalAPagar: number;
  selecionada: boolean;
}

export interface SimulacaoResultado {
  id: string;
  ativo: { id: string; descricao: string };
  valorEntrada: number;
  prazoSemanas: number;
  precificacaoProvisoria: boolean;
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
}

export interface Cadastro {
  nome: string;
  tipoPessoa?: 'pf' | 'pj';
  cpfCnpj: string;
  whatsapp: string;
  email?: string;
}

export const originacaoService = {
  async ativosDisponiveis(): Promise<AtivoDisponivel[]> {
    const { data } = await api.get('/api/v1/ativos', { params: { status: 'disponivel', limit: 100 } });
    return data.data;
  },
  async criarLead(body: { nome: string; cpf: string }): Promise<{ tipo: string; lead?: { id: string }; titular?: { nome: string } }> {
    const { data } = await api.post('/api/v1/leads', body);
    return data;
  },
  async simular(body: { ativoId: string; valorEntrada: number; prazoSemanas: number; leadId?: string }): Promise<SimulacaoResultado> {
    const { data } = await api.post('/api/v1/simulacoes', body);
    return data;
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
  async anexarDocumento(id: string, titularId: string, tipo: string): Promise<PropostaDetalhe> {
    const { data } = await api.post(`/api/v1/propostas/${id}/documentos`, { titularId, tipo });
    return data;
  },
  async registrarParecer(id: string, body: { resultado: string; motivoReprovacao?: string; exigeGarantidor?: boolean }): Promise<PropostaDetalhe> {
    const { data } = await api.post(`/api/v1/propostas/${id}/parecer`, body);
    return data;
  },
  async formalizar(id: string): Promise<{ contratoId: string; numero: string; status: string; documento: string }> {
    const { data } = await api.post(`/api/v1/propostas/${id}/formalizar`, {});
    return data;
  },
  async ativar(contratoId: string): Promise<{ status: string; entrada: number; cobranca: { id: string } }> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/ativar`, {});
    return data;
  },
  async simularPagamentoAtivacao(contratoId: string): Promise<{ status: string }> {
    const { data } = await api.post(`/api/v1/dev/simular-pagamento-ativacao/${contratoId}`, {});
    return data;
  },
};
