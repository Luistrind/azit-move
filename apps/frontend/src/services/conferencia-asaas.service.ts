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
  valorPagoAqui: number | null; // centavos — só existe depois de pagamento parcial
  asaasChargeId: string;
  asaas: CobrancaAsaasConferida | null; // null = removida (404)
  classificacao: ClassificacaoConferenciaAsaas;
}

export interface ConferenciaAsaas {
  periodo: { de: string | null; ate: string | null };
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

// Conferência AUTOMÁTICA diária (doc 02 §27.9.1, 18/11/2026): todo dia, de
// madrugada, o sistema lê no Asaas toda fatura em aberto com cobrança (vencida,
// de hoje e a vencer) e baixa as que estão pagas lá — pelo MESMO Reconciliar.
export interface ItemRodadaConferencia {
  faturaId: string;
  numero: number;
  titularId: string;
  titular: string;
  vencimento: string;
  situacao: 'vencida' | 'vence_hoje' | 'a_vencer';
  valorAqui: number; // centavos
  asaasChargeId: string;
  statusAsaas: string | null;
  valorAsaas: number | null; // centavos
  dataPagamentoAsaas: string | null;
  classificacao: ClassificacaoConferenciaAsaas | 'pago_a_menor_ja_registrado';
}

export interface RodadaConferenciaAsaas {
  dia: string;
  origem: 'agendada' | 'manual';
  disparadaPor: string | null;
  iniciadaEm: string;
  concluidaEm: string;
  ambiente: 'simulado' | 'sandbox' | 'producao';
  lidas: { total: number; vencidas: number; venceHoje: number; aVencer: number };
  baixadas: (ItemRodadaConferencia & { pagoEm: string; valorPago: number; situacaoAgora: 'baixada' | 'aguardando_conciliacao' })[];
  naoBaixadas: (ItemRodadaConferencia & { motivo: string })[];
  divergencias: ItemRodadaConferencia[];
  divergenciasNovas: number;
  semLeitura: { faturaId: string; asaasChargeId: string; erro: string }[];
}

export interface PainelConferenciaAutomatica {
  horario: string; // "3h30" (provisório)
  ultima: RodadaConferenciaAsaas | null;
  anteriores: { dia: string; origem: 'agendada' | 'manual'; concluidaEm: string; lidas: number; baixadas: number; divergencias: number; semLeitura: number }[];
}

export const conferenciaAsaasService = {
  async painelAutomatica(): Promise<PainelConferenciaAutomatica> {
    const { data } = await api.get<PainelConferenciaAutomatica>('/api/v1/cobranca/conferencia-asaas/automatica');
    return data;
  },
  async rodarAutomaticaAgora(): Promise<{ enfileirado: true; jobId: string }> {
    const { data } = await api.post<{ enfileirado: true; jobId: string }>('/api/v1/cobranca/conferencia-asaas/automatica/rodar');
    return data;
  },
  async conferir(de?: string, ate?: string): Promise<ConferenciaAsaas> {
    const { data } = await api.get<ConferenciaAsaas>('/api/v1/cobranca/conferencia-asaas', { params: { de, ate } });
    return data;
  },
  async reconciliar(faturaId: string): Promise<ReconciliacaoEnfileirada> {
    const { data } = await api.post<ReconciliacaoEnfileirada>(`/api/v1/cobranca/conferencia-asaas/${faturaId}/reconciliar`);
    return data;
  },
};
