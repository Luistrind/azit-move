import { api } from '../lib/api';

// Catálogo de Produtos (Doc 2 §4.8). valorPadrao em centavos.
export interface Produto {
  id: string;
  nome: string;
  natureza: 'parcelado' | 'recorrente';
  credorPadrao: 'azit' | 'investidor' | 'terceiro';
  apartado: boolean;
  valorPadrao: number | null;
  periodicidade: 'semanal' | 'quinzenal' | 'mensal' | null;
  ancora: boolean;
  ativo: boolean;
}

export interface ProdutoBody {
  nome: string;
  natureza: 'parcelado' | 'recorrente';
  credorPadrao?: 'azit' | 'investidor' | 'terceiro';
  apartado?: boolean;
  valorPadrao?: number;
  periodicidade?: 'semanal' | 'quinzenal' | 'mensal';
  ancora?: boolean;
}

export const produtoService = {
  async listar(): Promise<Produto[]> {
    const { data } = await api.get('/api/v1/produtos');
    return data;
  },
  async criar(body: ProdutoBody): Promise<Produto> {
    const { data } = await api.post('/api/v1/produtos', body);
    return data;
  },
  async atualizar(id: string, body: Partial<ProdutoBody> & { ativo?: boolean }): Promise<Produto> {
    const { data } = await api.patch(`/api/v1/produtos/${id}`, body);
    return data;
  },
};
