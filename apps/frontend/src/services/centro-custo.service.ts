import { api } from '../lib/api';

// Centro de custo (Doc 2 §4.4-A). Valores em CENTAVOS.
export interface CentroCustoAtivo {
  ativoId: string;
  descricao: string;
  placa: string | null;
  status: string;
  aquisicao: number;
  custosExtras: number;
  totalGasto: number;
  recebido: number;
  aReceber: number;
  resultado: number;
}

export interface LancamentoCusto {
  id: string;
  tipo: string;
  descricao: string;
  valor: number;
  data: string;
}

export interface CentroCustoDetalhe extends CentroCustoAtivo {
  lancamentos: LancamentoCusto[];
  contratos: {
    contratoId: string;
    numero: string;
    status: string;
    titular: string;
    entradaPaga: number;
    parcelasPagas: number;
    emAberto: number;
  }[];
}

export interface CentroCustoCredito {
  totalLiberado: number;
  totalRetornado: number;
  totalEmAberto: number;
  quantidade: number;
  creditos: {
    contratoId: string;
    numero: string;
    titular: string;
    finalidade: string;
    status: string;
    liberado: number;
    retornado: number;
    emAberto: number;
  }[];
}

export const centroCustoService = {
  async ativos(): Promise<CentroCustoAtivo[]> {
    const { data } = await api.get<CentroCustoAtivo[]>('/api/v1/centros-custo/ativos');
    return data;
  },
  async detalhe(ativoId: string): Promise<CentroCustoDetalhe> {
    const { data } = await api.get<CentroCustoDetalhe>(`/api/v1/centros-custo/ativos/${ativoId}`);
    return data;
  },
  async criarLancamento(
    ativoId: string,
    body: { tipo: string; descricao: string; valor: number; data?: string },
  ): Promise<CentroCustoDetalhe> {
    const { data } = await api.post(`/api/v1/centros-custo/ativos/${ativoId}/lancamentos`, body);
    return data;
  },
  async removerLancamento(id: string): Promise<CentroCustoDetalhe> {
    const { data } = await api.delete(`/api/v1/centros-custo/lancamentos/${id}`);
    return data;
  },
  async creditoAvulso(): Promise<CentroCustoCredito> {
    const { data } = await api.get<CentroCustoCredito>('/api/v1/centros-custo/credito-avulso');
    return data;
  },
};
