import { api } from '../lib/api';

// Régua de cobrança (Doc 7 Bloco 5). Valores em centavos.
export interface ReguaItem {
  id: string;
  numero: string;
  bloqueado: boolean;
  emRecuperacao: boolean;
  diasAtraso: number;
  estagio: string; // 'D+1' | 'D+2' | 'D+3' | 'D+10' | 'D+12'
  valorVencido: number;
  parcelasVencidas: number;
  titular: { nome: string; cpfCnpj: string };
  ativo: { placa: string | null; modelo: string | null };
}

export const reguaService = {
  async listar(): Promise<ReguaItem[]> {
    const { data } = await api.get<ReguaItem[]>('/api/v1/regua');
    return data;
  },
  async bloquear(contratoId: string): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/bloquear`);
  },
  async desbloquear(contratoId: string): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/desbloquear`);
  },
  // Dev: roda a régua (varre inadimplência + cobrança automática D+1/D+2).
  async rodar(): Promise<void> {
    await api.post('/api/v1/dev/varrer-regua');
  },
};
