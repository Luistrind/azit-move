import { api } from '../lib/api';

// Contas a Pagar — Financeiro Administrativo (doc 02 §18). Valores em CENTAVOS.

export interface ConfiguracaoFinanceiro {
  entidades: { id: string; razaoSocial: string; cnpj: string | null; unidadeNegocio: string | null; estruturaId?: string | null; estruturaNome?: string | null; ativo: boolean; contas: { id: string; banco: string; agencia: string | null; conta: string | null; tipo: string | null; ativo: boolean }[] }[];
  naturezas: { id: string; codigo: string; nome: string; exigeAtivo: boolean; exigeCotacao: boolean; especial: boolean; exigeJustificativa: boolean; ativo: boolean }[];
  centros: { id: string; codigo: string; nome: string; responsavelUsuarioId: string | null; ativo: boolean }[];
}

export interface FornecedorFinanceiro {
  id: string;
  cpfCnpj: string;
  nome: string;
  contato: string | null;
  email: string | null;
  status: string;
  alertaProximoPagamento: boolean;
  motivoBloqueio: string | null;
  dadosBancarios: { id: string; versao: number; banco: string | null; agencia: string | null; conta: string | null; chavePix: string | null; ativo: boolean; motivo: string | null; criadoEm: string }[];
}

export interface TituloPagarApi {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  competencia: string | null;
  status: string;
  urgente: boolean;
  justificativaUrgencia: string | null;
  formaPagamento: string;
  responsavelEconomico: string;
  ativoId: string | null;
  contratoCreditoId: string | null;
  loteId: string | null;
  dataProgramada: string | null;
  motivoDevolucao: string | null;
  motivoBloqueio: string | null;
  criadoEm: string;
  entidade: { id: string; nome: string };
  fornecedor: { id: string; nome: string; status: string; alertaProximoPagamento: boolean };
  natureza: { id: string; codigo: string; nome: string };
  centro: { id: string; codigo: string; nome: string };
  documentos: { id: string; tipo: string; nome: string; versao: number }[];
  pagamentos: { id: string; dataEfetiva: string; valorEfetivo: number; identificador: string | null; comprovanteNome: string | null; divergencia: string | null; conciliacao: { id: string; status: string; dataSaida: string; valorExtrato: number } | null }[];
}

export interface OrcamentoApi {
  id: string;
  descricao: string;
  entidadeId: string;
  urgencia: string;
  status: string;
  justificativaDispensa: string | null;
  tituloGeradoId: string | null;
  criadoEm: string;
  propostas: { id: string; fornecedor: string | null; fornecedorId: string | null; valor: number; prazo: string | null; garantia: string | null; condicao: string | null; selecionado: boolean; motivoSelecao: string | null }[];
}

export interface LotePagamentoApi {
  id: string;
  entidade: string;
  conta: string;
  dataProgramada: string;
  versao: number;
  status: string;
  urgente: boolean;
  totalValor: number;
  totalItens: number;
  enviadoEm: string | null;
  titulos: { id: string; descricao: string; fornecedor: string; valor: number; status: string; alertaBancario: boolean }[];
}

export const financeiroService = {
  async configuracao(): Promise<ConfiguracaoFinanceiro> {
    const { data } = await api.get('/api/v1/financeiro/configuracao');
    return data;
  },
  async criarEntidade(body: { razaoSocial: string; cnpj?: string; unidadeNegocio?: string; estruturaId?: string }) {
    const { data } = await api.post('/api/v1/financeiro/entidades', body);
    return data;
  },
  async criarConta(entidadeId: string, body: { banco: string; agencia?: string; conta?: string; tipo?: string }) {
    const { data } = await api.post(`/api/v1/financeiro/entidades/${entidadeId}/contas`, body);
    return data;
  },
  async criarNatureza(body: { codigo: string; nome: string; exigeAtivo?: boolean; exigeCotacao?: boolean; especial?: boolean; exigeJustificativa?: boolean }) {
    const { data } = await api.post('/api/v1/financeiro/naturezas', body);
    return data;
  },
  async criarCentro(body: { codigo: string; nome: string }) {
    const { data } = await api.post('/api/v1/financeiro/centros', body);
    return data;
  },

  async fornecedores(): Promise<FornecedorFinanceiro[]> {
    const { data } = await api.get('/api/v1/financeiro/fornecedores');
    return data;
  },
  async criarFornecedor(body: { cpfCnpj: string; nome: string; contato?: string; email?: string; banco?: string; agencia?: string; conta?: string; chavePix?: string }) {
    const { data } = await api.post('/api/v1/financeiro/fornecedores', body);
    return data;
  },
  async alterarDadosBancarios(id: string, body: { banco?: string; agencia?: string; conta?: string; chavePix?: string; motivo: string }) {
    const { data } = await api.post(`/api/v1/financeiro/fornecedores/${id}/dados-bancarios`, body);
    return data;
  },
  async statusFornecedor(id: string, status: string, motivo?: string) {
    const { data } = await api.post(`/api/v1/financeiro/fornecedores/${id}/status`, { status, motivo });
    return data;
  },

  async orcamentos(): Promise<OrcamentoApi[]> {
    const { data } = await api.get('/api/v1/financeiro/orcamentos');
    return data;
  },
  async criarOrcamento(body: { entidadeId: string; descricao: string; naturezaId?: string; centroCustoAreaId?: string; ativoId?: string; urgencia?: string; justificativaDispensa?: string; propostas: { fornecedorId?: string; nomeFornecedor?: string; valor: number; prazo?: string; condicao?: string }[] }) {
    const { data } = await api.post('/api/v1/financeiro/orcamentos', body);
    return data;
  },
  async submeterOrcamento(id: string, propostaId: string, motivoSelecao?: string) {
    const { data } = await api.post(`/api/v1/financeiro/orcamentos/${id}/submeter`, { propostaId, motivoSelecao });
    return data;
  },
  async converterOrcamento(id: string, body: { fornecedorId: string; vencimento: string; competencia?: string; naturezaId: string; centroCustoAreaId: string; formaPagamento?: string }) {
    const { data } = await api.post(`/api/v1/financeiro/orcamentos/${id}/converter`, body);
    return data;
  },

  async titulos(status?: string): Promise<TituloPagarApi[]> {
    const { data } = await api.get('/api/v1/financeiro/titulos', { params: status ? { status } : {} });
    return data;
  },
  async criarTitulo(body: Record<string, unknown>) {
    const { data } = await api.post('/api/v1/financeiro/titulos', body);
    return data;
  },
  async validarTitulo(id: string, decisao: 'validar' | 'devolver' | 'bloquear', motivo?: string) {
    const { data } = await api.post(`/api/v1/financeiro/titulos/${id}/validar`, { decisao, motivo });
    return data;
  },
  async reenviarTitulo(id: string, body: { descricao?: string; valor?: number; vencimento?: string; documentoNome?: string }) {
    const { data } = await api.post(`/api/v1/financeiro/titulos/${id}/reenviar`, body);
    return data;
  },
  async cancelarTitulo(id: string, motivo: string) {
    const { data } = await api.post(`/api/v1/financeiro/titulos/${id}/cancelar`, { motivo });
    return data;
  },
  async solicitarReabertura(id: string, motivo: string) {
    const { data } = await api.post(`/api/v1/financeiro/titulos/${id}/solicitar-reabertura`, { motivo });
    return data;
  },
  async registrarPagamento(id: string, body: { dataEfetiva: string; valorEfetivo: number; identificador?: string; comprovanteNome: string; divergencia?: string }) {
    const { data } = await api.post(`/api/v1/financeiro/titulos/${id}/pagamento`, body);
    return data;
  },
  async conciliar(pagamentoId: string, body: { dataSaida: string; valorExtrato: number; observacao?: string }) {
    const { data } = await api.post(`/api/v1/financeiro/pagamentos/${pagamentoId}/conciliar`, body);
    return data;
  },

  async lotes(): Promise<LotePagamentoApi[]> {
    const { data } = await api.get('/api/v1/financeiro/lotes');
    return data;
  },
  async criarLote(body: { entidadeId: string; contaBancariaId: string; dataProgramada?: string; tituloIds: string[]; urgente?: boolean }) {
    const { data } = await api.post('/api/v1/financeiro/lotes', body);
    return data;
  },
  async eventoLote(id: string, evento: 'enviado_bpo' | 'cadastrado_cora' | 'aprovado_banco') {
    const { data } = await api.post(`/api/v1/financeiro/lotes/${id}/evento`, { evento });
    return data;
  },
  async baixarResumoLote(id: string) {
    const resp = await api.get(`/api/v1/financeiro/lotes/${id}/resumo`, { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resumo-lote-${id.slice(-6)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
