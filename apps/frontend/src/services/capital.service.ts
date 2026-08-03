import { api } from '../lib/api';

// Pessoas/classificações + camada de capital (doc 02 §15). Valores em centavos.

export interface PessoaClassificada {
  id: string;
  nome: string;
  cpfCnpj: string;
  whatsapp: string;
  classificacoes: string[];
  estruturas: { id: string; nome: string; valorAportado: number | null }[];
}

export interface InvestidorEstrutura {
  titularId: string;
  nome: string;
  cpfCnpj: string;
  valorAportado: number | null;
  tipoInstrumento: string | null;
  dataAporte: string | null;
}

export interface EstruturaJuridica {
  id: string;
  nome: string;
  tipo: string;
  cnpj: string | null;
  rodada: string | null;
  ativo: boolean;
  observacoes: string | null;
  investidores: InvestidorEstrutura[];
  ativos: { ativoId: string; descricao: string; placa: string | null }[];
  totalAportado: number;
}

export const capitalService = {
  async pessoas(classificacao?: string): Promise<PessoaClassificada[]> {
    const { data } = await api.get<PessoaClassificada[]>('/api/v1/pessoas', {
      params: classificacao ? { classificacao } : {},
    });
    return data;
  },
  async classificar(titularId: string, classificacao: string, observacao?: string) {
    const { data } = await api.post(`/api/v1/titulares/${titularId}/classificacoes`, {
      classificacao,
      observacao,
    });
    return data;
  },
  async desclassificar(titularId: string, classificacao: string) {
    await api.delete(`/api/v1/titulares/${titularId}/classificacoes/${classificacao}`);
  },
  async estruturas(): Promise<EstruturaJuridica[]> {
    const { data } = await api.get<EstruturaJuridica[]>('/api/v1/estruturas');
    return data;
  },
  async criarEstrutura(body: { nome: string; tipo?: string; cnpj?: string; rodada?: string; observacoes?: string }) {
    const { data } = await api.post('/api/v1/estruturas', body);
    return data;
  },
  async atualizarEstrutura(id: string, body: Partial<{ nome: string; tipo: string; cnpj: string; rodada: string; observacoes: string; ativo: boolean }>) {
    const { data } = await api.patch(`/api/v1/estruturas/${id}`, body);
    return data;
  },
  async vincularInvestidor(estruturaId: string, body: { titularId: string; valorAportado?: number; tipoInstrumento?: string; dataAporte?: string; observacao?: string }) {
    const { data } = await api.post(`/api/v1/estruturas/${estruturaId}/investidores`, body);
    return data;
  },
  async desvincularInvestidor(estruturaId: string, titularId: string) {
    await api.delete(`/api/v1/estruturas/${estruturaId}/investidores/${titularId}`);
  },
  async vincularAtivo(estruturaId: string, ativoId: string) {
    const { data } = await api.post<{ resultado?: string; erro?: string; mensagem?: string }>(
      `/api/v1/estruturas/${estruturaId}/ativos/${ativoId}`,
    );
    return data;
  },
};

// Nomes por extenso em tela (P4 — sem siglas/códigos).
export const NOME_CLASSIFICACAO: Record<string, string> = {
  INVESTIDOR: 'Investidor',
  FORNECEDOR: 'Fornecedor',
  PARCEIRO: 'Parceiro',
};

export const NOME_TIPO_ESTRUTURA: Record<string, string> = {
  SPE: 'Sociedade de propósito específico',
  FUNDO: 'Fundo',
  OUTRA: 'Outra estrutura',
};
