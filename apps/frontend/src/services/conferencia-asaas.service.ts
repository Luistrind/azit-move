import { api } from '../lib/api';
import type { ClassificacaoConferenciaAsaas } from '@azit/utils';

// Conferência Asaas × sistema (doc 02 §27.9, 12/11/2026): faturas em aberto aqui
// lidas uma a uma no Asaas, lado a lado, com a divergência classificada no
// backend. Só leitura; `reconciliar` só vale para `paga_no_asaas` e enfileira o
// MESMO job do webhook (202) — nada muda de forma síncrona.

export interface CobrancaAsaasConferida {
  id: string;
  status: string;
  vencimento: string; // YYYY-MM-DD
  valor: number; // centavos
  valorOriginal: number | null; // centavos
  dataPagamento: string | null;
  deleted: boolean;
  invoiceUrl: string | null;
}

export interface LinhaConferenciaAsaas {
  faturaId: string;
  numero: number;
  contaId: string;
  titularId: string;
  titular: string;
  statusAqui: string;
  situacaoAqui: 'vencida' | 'a_vencer';
  vencimentoAqui: string;
  valorAqui: number; // centavos
  asaasChargeId: string;
  asaas: CobrancaAsaasConferida | null; // null = removida (404)
  classificacao: ClassificacaoConferenciaAsaas;
}

export interface ConferenciaAsaas {
  periodo: { de: string | null; ate: string };
  hoje: string;
  consultadoEm: string;
  ambiente: 'simulado' | 'sandbox' | 'producao';
  total: number;
  porClassificacao: Record<ClassificacaoConferenciaAsaas, number>;
  falhas: { faturaId: string; asaasChargeId: string; erro: string }[];
  linhas: LinhaConferenciaAsaas[];
}

export interface ReconciliacaoEnfileirada {
  enfileirado: true;
  statusAsaas: string;
  job: { faturaId: string; paymentDate: string; dueDate: string; valor: number };
}

export const conferenciaAsaasService = {
  async conferir(de?: string, ate?: string): Promise<ConferenciaAsaas> {
    const { data } = await api.get<ConferenciaAsaas>('/api/v1/cobranca/conferencia-asaas', { params: { de, ate } });
    return data;
  },
  async reconciliar(faturaId: string): Promise<ReconciliacaoEnfileirada> {
    const { data } = await api.post<ReconciliacaoEnfileirada>(`/api/v1/cobranca/conferencia-asaas/${faturaId}/reconciliar`);
    return data;
  },
};
