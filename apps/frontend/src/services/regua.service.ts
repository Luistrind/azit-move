import { api } from '../lib/api';

// Régua de cobrança (Doc 7 Bloco 5). Valores em centavos.
export interface ReguaItem {
  id: string;
  numero: string;
  contaId: string; // renegociação é da CONTA (doc 02 §7.7) — abre o caso do card
  bloqueado: boolean;
  emRecuperacao: boolean;
  diasAtraso: number;
  estagio: string; // 'D+1' | 'D+2' | 'D+3' | 'D+10' | 'D+12'
  valorVencido: number;
  parcelasVencidas: number;
  titular: { id: string; nome: string; cpfCnpj: string };
  mensagensNaoLidas: number; // respostas do cliente no WhatsApp ainda não lidas (doc 02 §24)
  ativo: { placa: string | null; modelo: string | null } | null; // null = sem ativo (RP)
  retomado: boolean;
  noJuridico: boolean;
  // Estado do POP-COB-001 (doc 02 §23) — só contrato de veículo.
  pop: {
    fase: string;
    ultimaEtapa: number | null;
    proxima: { etapa: number; condicao: string; prevista: string | null } | null;
    monitorarVeiculo: boolean;
    bloqueioLiberado: boolean;
    bloqueioLiberadoEm: string | null;
    rescisaoSinalizada: boolean;
    parcelasVencidas: number;
  } | null;
}

export const reguaService = {
  async listar(): Promise<ReguaItem[]> {
    const { data } = await api.get<ReguaItem[]>('/api/v1/regua');
    return data;
  },
  // Regra 6 (POP-COB-001): antes de 24h após a 4ª notificação, exige justificativa.
  async bloquear(contratoId: string, justificativa?: string): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/bloquear`, { justificativa });
  },
  async desbloquear(contratoId: string): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/desbloquear`);
  },
  // Dev: roda a varredura diária da régua (as notificações do POP têm fila própria).
  async rodar(): Promise<void> {
    await api.post('/api/v1/dev/varrer-regua');
  },
};
