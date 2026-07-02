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

export interface CreditoPendente {
  contratoId: string;
  numero: string;
  titularId: string;
  titular: string;
  descricao: string;
  valorTotal: number;
  valorEntrada: number;
  numeroParcelas: number;
  valorParcela: number;
  solicitadoPor: string | null;
  solicitadoEm: string;
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
  async pendentes(): Promise<CreditoPendente[]> {
    const { data } = await api.get<CreditoPendente[]>('/api/v1/creditos/pendentes');
    return data;
  },
  async aprovar(contratoId: string): Promise<{ status: string }> {
    const { data } = await api.post(`/api/v1/creditos/${contratoId}/aprovar`);
    return data;
  },
  async reprovar(contratoId: string, motivo?: string): Promise<{ status: string }> {
    const { data } = await api.post(`/api/v1/creditos/${contratoId}/reprovar`, { motivo });
    return data;
  },
};
