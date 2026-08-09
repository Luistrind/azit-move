import { api } from '../lib/api';

// Consulta/edição de Titular (Bloco 7 — tela de apoio). O titular NÃO nasce aqui:
// é formado no funil (Lead → promoção). Esta tela só consulta e edita o cadastro VIVO.
export interface Titular {
  id: string;
  nome: string;
  tipoPessoa: string;
  cpfCnpj: string;
  rg: string | null;
  estadoCivil: string | null;
  profissao: string | null;
  whatsapp: string;
  email: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  status: string;
}

export interface FichaTitular {
  titular: Titular;
  conta: { id: string; status: string; dataAbertura: string } | null;
  contratosCredito: { id: string; numero: string; status: string; saldoDevedor: number; dataAssinatura: string }[];
  contratosInvestimento: { id: string; numero: string; status: string; valorAportado: number }[];
}

export interface DetalheTitular {
  titular: Titular;
  conta: { id: string; status: string; dataAbertura: string } | null;
  documentos: { id: string; tipo: string; arquivoRef: string; dataAnexo: string }[];
  resumoFinanceiro: {
    valorEmContratoAtivo: number;
    valorPago: number;
    saldoDevedor: number;
    valorEmAtraso: number;
    quantidadeRenegociacoes: number;
    contratosAtivos: number;
    contratosTotal: number;
  };
  contratosCredito: { id: string; numero: string; status: string; valorTotal: number; saldoDevedor: number; dataAssinatura: string }[];
  contratosInvestimento: { id: string; numero: string; status: string; valorAportado: number }[];
}

// Campos editáveis do cadastro VIVO (nunca tocam contratos assinados — imutabilidade).
export interface AtualizarTitularBody {
  nome?: string;
  rg?: string;
  estadoCivil?: string;
  profissao?: string;
  whatsapp?: string;
  email?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
}

export const titularService = {
  // Cadastro direto (ex.: pessoa investidora — homologação 04/08); o cliente do
  // funil continua nascendo Lead → promoção.
  async criar(body: { nome: string; tipoPessoa: 'pf' | 'pj'; cpfCnpj: string; whatsapp: string; email?: string }): Promise<Titular> {
    const { data } = await api.post<Titular>('/api/v1/titulares', body);
    return data;
  },
  async listar(params: { cpfCnpj?: string; nome?: string } = {}): Promise<{ total: number; data: Titular[] }> {
    const { data } = await api.get('/api/v1/titulares', { params: { limit: 100, ...params } });
    return data;
  },
  // Consultas de birô da pessoa (decisão 09/08) — histórico completo na ficha.
  async consultasBiro(id: string): Promise<{
    id: string; tipo: string; fornecedor: string; protocolo: string | null; dataConsulta: string;
    situacao: string; motivoFalha: string | null; tentativas: number;
    resultado: Record<string, unknown> | null; analiseId: string; propostaId: string;
  }[]> {
    const { data } = await api.get(`/api/v1/titulares/${id}/consultas-biro`);
    return data;
  },
  async ficha(id: string): Promise<FichaTitular> {
    const { data } = await api.get(`/api/v1/titulares/${id}/ficha`);
    return data;
  },
  async detalhe(id: string): Promise<DetalheTitular> {
    const { data } = await api.get(`/api/v1/titulares/${id}/detalhe`);
    return data;
  },
  async atualizar(id: string, body: AtualizarTitularBody): Promise<Titular> {
    const { data } = await api.patch(`/api/v1/titulares/${id}`, body);
    return data;
  },
};
