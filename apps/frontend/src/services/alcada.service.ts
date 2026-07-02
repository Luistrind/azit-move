import { api } from '../lib/api';

// Alçadas configuráveis (Doc 2 §7.9) — matriz papel × operação. Limites em CENTAVOS.
export interface OperacaoAlcada {
  chave: string;
  nome: string;
  ativo: boolean;
}
export interface CelulaAlcada {
  papel: string;
  tipoOperacao: string;
  limiteMaximo: number; // centavos
  ilimitado: boolean;
  ativo: boolean;
}
export interface MatrizAlcada {
  papeis: string[];
  operacoes: OperacaoAlcada[];
  celulas: CelulaAlcada[];
}

export const alcadaService = {
  async matriz(): Promise<MatrizAlcada> {
    const { data } = await api.get<MatrizAlcada>('/api/v1/alcadas');
    return data;
  },
  async salvar(body: {
    papel: string;
    tipoOperacao: string;
    limiteMaximo?: number;
    ilimitado?: boolean;
    ativo?: boolean;
  }): Promise<MatrizAlcada> {
    const { data } = await api.put<MatrizAlcada>('/api/v1/alcadas', body);
    return data;
  },
  async criarOperacao(body: { chave: string; nome: string }): Promise<MatrizAlcada> {
    const { data } = await api.post<MatrizAlcada>('/api/v1/alcadas/operacoes', body);
    return data;
  },
};
