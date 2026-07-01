import { api } from '../lib/api';

// Chamadas da Carteira / Contrato (Doc 7 itens 3.7–3.8). Valores em centavos.

export interface ContratoListaItem {
  id: string;
  numero: string;
  status: string;
  dataAssinatura: string;
  valorTotal: number;
  saldoDevedor: number;
  saldoDevedorAtual: number;
  numeroParcelas: number;
  parcelasPagas: number;
  titular: { id: string; nome: string; cpfCnpj: string };
  ativo: { placa: string | null; modelo: string | null; anoModelo: number | null };
}

export interface ListaContratos {
  total: number;
  page: number;
  limit: number;
  data: ContratoListaItem[];
}

export interface ContratoKpis {
  totalContratos: number;
  porStatus: { status: string; total: number }[];
  saldoDevedorTotal: number;
  carteiraSobGestao: number;
  contratosAtivos: number;
  inadimplentes: number;
  inadimplenciaPct: number;
  recebidoNaSemana: number;
}

export interface ContratoDetalhe {
  id: string;
  numero: string;
  status: string;
  dataAssinatura: string;
  dataPrimeiraParcela: string;
  valorTotal: number;
  valorEntrada: number;
  saldoDevedor: number;
  numeroParcelas: number;
  periodicidade: string;
  titular: { id: string; nome: string; cpfCnpj: string; whatsapp: string };
  ativo: {
    placa: string | null;
    modelo: string | null;
    descricao: string;
    anoModelo: number | null;
    origemCapitalTipo: string | null;
  };
  resumo: {
    parcelasPagas: number;
    totalParcelas: number;
    valorPago: number;
    saldoDevedorAtual: number;
    proximaParcela: { numero: number; dataVencimento: string; valorNominal: number } | null;
  };
}

export interface ParcelaCronograma {
  id: string;
  numero: number;
  totalParcelas: number;
  display: string;
  valorNominal: number;
  dataVencimento: string;
  status: string;
  composicao: string | null;
}

export interface ExtratoEvento {
  tipo: string;
  label: string;
  data: string;
  valor: number;
  encargo: number;
  atraso: boolean;
}

export const contratoService = {
  async kpis(): Promise<ContratoKpis> {
    const { data } = await api.get<ContratoKpis>('/api/v1/contratos/kpis');
    return data;
  },
  async listar(params: { page?: number; limit?: number; status?: string } = {}): Promise<ListaContratos> {
    const { data } = await api.get<ListaContratos>('/api/v1/contratos', { params });
    return data;
  },
  async detalhe(id: string): Promise<ContratoDetalhe> {
    const { data } = await api.get<ContratoDetalhe>(`/api/v1/contratos/${id}`);
    return data;
  },
  async cronograma(id: string): Promise<ParcelaCronograma[]> {
    const { data } = await api.get<ParcelaCronograma[]>(`/api/v1/contratos/${id}/cronograma`);
    return data;
  },
  async extrato(id: string): Promise<ExtratoEvento[]> {
    const { data } = await api.get<ExtratoEvento[]>(`/api/v1/contratos/${id}/extrato`);
    return data;
  },
  async documento(id: string): Promise<{ numero: string; texto: string; disponivel: boolean }> {
    const { data } = await api.get(`/api/v1/contratos/${id}/documento`);
    return data;
  },
  // Dev: simula o pagamento da próxima parcela (dispara a conciliação real).
  async simularPagamento(id: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-pagamento/${id}`);
  },
};
