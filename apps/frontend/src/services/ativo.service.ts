import { api } from '../lib/api';

// Cadastro/estoque de Ativo (Bloco 7 — tela de apoio). Valores em centavos.
export interface Ativo {
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
  status: string;
}

export interface OrigemCapital {
  tipo: string;
  valorAportado: number;
  taxaRetorno: number | null;
  dataAporte: string;
  status?: string;
}

export interface CriarAtivoBody {
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

export interface OrigemCapitalBody {
  tipo: string;
  valorAportado: number;
  taxaRetorno?: number;
  dataAporte: string;
}

export const ativoService = {
  async listar(params: { status?: string; placa?: string; chassi?: string } = {}): Promise<{ total: number; data: Ativo[] }> {
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
  async atualizar(id: string, body: Partial<CriarAtivoBody> & { status?: string }): Promise<Ativo> {
    const { data } = await api.patch(`/api/v1/ativos/${id}`, body);
    return data;
  },
  async origemCapital(ativoId: string): Promise<OrigemCapital | null> {
    try {
      const { data } = await api.get(`/api/v1/ativos/${ativoId}/origem-capital`);
      return data;
    } catch {
      return null;
    }
  },
  async definirOrigemCapital(ativoId: string, body: OrigemCapitalBody): Promise<OrigemCapital> {
    const { data } = await api.post(`/api/v1/ativos/${ativoId}/origem-capital`, body);
    return data;
  },
  async atualizarOrigemCapital(ativoId: string, body: { valorAportado?: number; taxaRetorno?: number }): Promise<OrigemCapital> {
    const { data } = await api.patch(`/api/v1/ativos/${ativoId}/origem-capital`, body);
    return data;
  },
};
