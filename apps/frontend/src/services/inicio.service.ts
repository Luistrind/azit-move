import { api } from '../lib/api';

// Tela Início — fila de trabalho por papel (proposta UX §4.3).
export interface ItemFila {
  titulo: string;
  subtitulo: string;
  rota: string;
}
export interface BlocoFila {
  area: string;
  titulo: string;
  quantidade: number;
  vazio: string;
  rota: string;
  rotaRotulo: string;
  itens: ItemFila[];
}

export const inicioService = {
  async fila(): Promise<BlocoFila[]> {
    const { data } = await api.get<{ blocos: BlocoFila[] }>('/api/v1/inicio/fila');
    return data.blocos;
  },
};
