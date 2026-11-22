import { api } from '../lib/api';

// Lembretes de pagamento pelo WhatsApp (doc 02 §28): o lembrete por titular
// (desligado por padrão), o aviso do próprio Asaas e os lembretes registrados.

export interface LembreteRegistrado {
  id: string;
  faturaId: string;
  faturaNumero: number;
  vencimento: string;
  momento: string; // D_MENOS_2 | D_ZERO | D_MAIS_2
  situacao: string; // PREPARADO | ENVIADO | ENTREGUE | LIDO | FALHOU | SIMULADO | RETIDO
  motivo: string | null;
  destino: string | null;
  texto: string;
  modelo: string;
  comPix: boolean; // levou o Pix copia e cola (doc 02 §28.6)
  registradoEm: string;
  enviadoEm: string | null;
  entregueEm: string | null;
  lidoEm: string | null;
  falhaEm: string | null;
}

export interface LembretesDoTitular {
  titularId: string;
  whatsapp: string | null;
  whatsappValido: boolean;
  // Conversa do número do cadastro em Conversas do WhatsApp (mensagens = 0: o cliente nunca escreveu).
  conversa: { numero: string | null; mensagens: number; naoLidas: number };
  lembrete: { ativo: boolean; ligadoEm: string | null; ligadoPor: string | null; desligadoEm: string | null; desligadoPor: string | null };
  avisoAsaas: { desligado: boolean; alteradoEm: string | null; alteradoPor: string | null; pendente: boolean; clienteNoAsaas: boolean };
  semAvisoNenhum: boolean;
  canal: { enviosAutomaticos: boolean; producao: boolean; decisao: string | null; motivo: string | null; enviaDeVerdade: boolean };
  lembretes: LembreteRegistrado[];
}

export interface ResumoLembretes {
  dia: string;
  titularesComLembrete: number;
  hoje: Record<string, number>;
  retidos: number;
  ultimos: { id: string; titular: { id: string; nome: string }; faturaNumero: number; vencimento: string; momento: string; situacao: string; motivo: string | null; registradoEm: string }[];
}

export interface ResumoVarredura {
  dia: string;
  executada: boolean;
  motivo: string | null;
  candidatas: number;
  enviados: number;
  simulados: number;
  retidos: number;
  falhas: number;
  ignoradas: number;
}

export const lembretesService = {
  async doTitular(titularId: string): Promise<LembretesDoTitular> {
    const { data } = await api.get<LembretesDoTitular>(`/api/v1/titulares/${titularId}/lembretes`);
    return data;
  },
  async ligar(titularId: string): Promise<LembretesDoTitular> {
    const { data } = await api.post<LembretesDoTitular>(`/api/v1/titulares/${titularId}/lembretes/ligar`);
    return data;
  },
  async desligar(titularId: string): Promise<LembretesDoTitular> {
    const { data } = await api.post<LembretesDoTitular>(`/api/v1/titulares/${titularId}/lembretes/desligar`);
    return data;
  },
  // Altera o cadastro do cliente NO ASAAS — ato explícito do operador.
  async definirAvisoAsaas(titularId: string, desligado: boolean): Promise<LembretesDoTitular> {
    const { data } = await api.post<LembretesDoTitular>(`/api/v1/titulares/${titularId}/lembretes/aviso-asaas`, { desligado });
    return data;
  },
  async resumo(): Promise<ResumoLembretes> {
    const { data } = await api.get<ResumoLembretes>('/api/v1/whatsapp/lembretes/resumo');
    return data;
  },
  // Ferramentas de teste (fora de produção)
  async varrerAgora(): Promise<ResumoVarredura> {
    const { data } = await api.post<ResumoVarredura>('/api/v1/dev/whatsapp/lembretes/varrer');
    return data;
  },
  async simularStatus(lembreteId: string, status: 'delivered' | 'read' | 'failed'): Promise<void> {
    await api.post(`/api/v1/dev/whatsapp/lembretes/${lembreteId}/simular-status`, { status });
  },
};
