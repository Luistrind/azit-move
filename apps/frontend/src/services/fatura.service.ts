import { api } from '../lib/api';

// Visão de faturas do cliente (por conta). Cada fatura agrega itens de todos os
// contratos/produtos do mesmo ciclo (Doc 2 §372). Valores em centavos.
export interface FaturaItem {
  descricao: string;
  tipo: string;
  valor: number;
  credor: string;
}
export interface Fatura {
  id: string;
  numero: number;
  periodoReferencia: string;
  dataVencimento: string;
  dataFechamento: string | null;
  dataPagamento: string | null;
  status: string;
  situacao: string; // em_aberto | vence_hoje | vencida | paga | ...
  valorTotal: number;
  valorPago: number;
  itens: FaturaItem[];
}

export interface FaturaDetalhe extends Fatura {
  titular: { id: string; nome: string };
}

export interface PaginaFaturas {
  total: number;
  page: number;
  limit: number;
  data: Fatura[];
}

export const faturaService = {
  async daConta(contaId: string, page = 1, limit = 8): Promise<PaginaFaturas> {
    const { data } = await api.get(`/api/v1/contas/${contaId}/faturas`, { params: { page, limit } });
    return data;
  },
  async detalhe(faturaId: string): Promise<FaturaDetalhe> {
    const { data } = await api.get(`/api/v1/faturas/${faturaId}`);
    return data;
  },
  // Dev: paga a fatura (enfileira a conciliação, como o webhook do Asaas).
  async simularPagamento(faturaId: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-pagamento-fatura/${faturaId}`);
  },
  // Dev: envelhece a fatura em 1 dia (simula atraso dia a dia).
  async envelhecer(faturaId: string): Promise<{ diasAtraso: number }> {
    const { data } = await api.post(`/api/v1/dev/envelhecer-fatura/${faturaId}`);
    return data;
  },
};
