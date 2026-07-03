import { api } from '../lib/api';

// Crédito de manutenção (crédito avulso para cliente já ativo) — Doc 2 §4.7-A. Centavos.
export interface SimulacaoCredito {
  valor: number;
  valorEntrada: number;
  valorFinanciado: number;
  numeroParcelas: number;
  valorParcela: number;
  totalAPagar: number;
  provisorio: boolean;
}

export interface OriginarCreditoBody {
  descricao: string;
  valor: number; // centavos
  numeroParcelas: number;
  valorEntrada: number; // centavos
  periodicidade: 'semanal' | 'quinzenal' | 'mensal';
}

export const creditoService = {
  async simular(body: { valor: number; numeroParcelas: number; valorEntrada: number }): Promise<SimulacaoCredito> {
    const { data } = await api.post<SimulacaoCredito>('/api/v1/creditos/simular', body);
    return data;
  },
  async originar(titularId: string, body: OriginarCreditoBody): Promise<{ contratoId: string; numero: string; status: string; valorParcela: number }> {
    const { data } = await api.post(`/api/v1/titulares/${titularId}/creditos`, body);
    return data;
  },
};
