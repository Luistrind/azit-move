import { api } from '../lib/api';

// Carteira consolidada por titular/conta (Doc 2: arquitetura centrada no titular).
export interface PosicaoConta {
  contaId: string;
  titularId: string;
  titular: string;
  cpfCnpj: string;
  contratosAtivos: number;
  contratosTotal: number;
  saldoDevedor: number; // centavos
  valorEmAtraso: number; // centavos
  faturasVencidas: number;
  bloqueada: boolean;
  situacao: 'em_dia' | 'em_atraso' | 'bloqueada';
}

export const contaService = {
  async carteira(): Promise<PosicaoConta[]> {
    const { data } = await api.get<PosicaoConta[]>('/api/v1/contas/carteira');
    return data;
  },
};
