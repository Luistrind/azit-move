import { api } from '../lib/api';
import type { VisaoCarteira, VisaoMensal } from '@azit/utils';

// Visão da carteira por período (doc 02 §27) — três rotas, uma agregação.
// Teto/pagas/vencidas/a vencer por VENCIMENTO; `recebido` é CAIXA (data de pagamento).
export interface VisaoPeriodo extends VisaoCarteira {
  periodo: { de: string; ate: string };
  hoje: string;
}
export type EstadoVisao = 'recebidas' | 'vencidas' | 'a_vencer';
export interface ClienteVisao {
  contaId: string;
  titularId: string;
  titular: string;
  valor: number; // centavos
  faturas: number; // recebidas: recebimentos (faturas + entradas)
  maisAntiga: string; // YYYY-MM-DD (recebidas: primeiro pagamento)
  ultimoPagamento?: string; // YYYY-MM-DD — só em recebidas
  bloqueada: boolean;
}

export const carteiraVisaoService = {
  async periodo(de: string, ate: string): Promise<VisaoPeriodo> {
    const { data } = await api.get<VisaoPeriodo>('/api/v1/contas/carteira/visao', { params: { de, ate } });
    return data;
  },
  async mensal(de: string, ate: string): Promise<VisaoMensal[]> {
    const { data } = await api.get<VisaoMensal[]>('/api/v1/contas/carteira/visao/mensal', { params: { de, ate } });
    return data;
  },
  async clientes(de: string, ate: string, estado: EstadoVisao): Promise<ClienteVisao[]> {
    const { data } = await api.get<ClienteVisao[]>('/api/v1/contas/carteira/visao/clientes', { params: { de, ate, estado } });
    return data;
  },
};
