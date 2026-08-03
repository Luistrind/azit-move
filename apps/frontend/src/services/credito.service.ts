import { api } from '../lib/api';

// Crédito de manutenção (crédito avulso para cliente já ativo) — Doc 2 §4.7-A. Centavos.
export interface SimulacaoCredito {
  produto: 'reembolso_parcelado' | 'credito_avulso';
  valor: number;
  valorEntrada: number;
  valorFinanciado: number;
  taxaInicial: number; // centavos — taxa inicial de processamento (financiada)
  encargoMensal: number; // fração a.m.
  limiteParcela: number | null; // centavos — 30% da parcela do contrato principal
  excedeLimite: boolean;
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
  async simular(body: { valor: number; numeroParcelas: number; valorEntrada: number; periodicidade?: string; titularId?: string }): Promise<SimulacaoCredito> {
    const { data } = await api.post<SimulacaoCredito>('/api/v1/creditos/simular', body);
    return data;
  },
  async originar(titularId: string, body: OriginarCreditoBody): Promise<{ contratoId: string; numero: string; status: string; valorParcela: number }> {
    const { data } = await api.post(`/api/v1/titulares/${titularId}/creditos`, body);
    return data;
  },
};
