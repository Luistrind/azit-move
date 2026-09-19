import { api } from '../lib/api';

// Conversas do WhatsApp (doc 02 §24, opção C): respostas dos clientes às
// notificações formais, atendidas no sistema.

export interface ResumoConversa {
  numero: string;
  titular: { id: string; nome: string } | null;
  nomePerfil: string | null;
  ultimaEm: string | null;
  ultimaDirecao: 'ENTRADA' | 'SAIDA' | null;
  ultimaPrevia: string;
  naoLidas: number;
}

export interface ItemConversa {
  id: string;
  origem: 'mensagem' | 'notificacao';
  direcao: 'ENTRADA' | 'SAIDA';
  momento: string;
  tipo: string;
  texto: string | null;
  temMidia: boolean;
  midiaDisponivel: boolean;
  midiaTipo: string | null;
  midiaNome: string | null;
  status: string | null;
  falhaMotivo: string | null;
  autor: string | null;
  lida: boolean;
  contratoId?: string;
}

export interface Conversa {
  numero: string;
  titular: { id: string; nome: string } | null;
  nomePerfil: string | null;
  contratos: { id: string; numero: string; ativo: { placa: string | null; modelo: string | null } | null }[];
  janela: { aberta: boolean; ate: string | null };
  envio: { provedorConfigurado: boolean; producao: boolean; numeroAutorizadoTeste: boolean };
  itens: ItemConversa[];
}

async function abrirBlob(url: string) {
  const resp = await api.get(url, { responseType: 'blob' });
  const u = URL.createObjectURL(resp.data as Blob);
  window.open(u, '_blank');
  setTimeout(() => URL.revokeObjectURL(u), 60_000);
}

export const conversasService = {
  async listar(): Promise<ResumoConversa[]> {
    const { data } = await api.get<ResumoConversa[]>('/api/v1/conversas-whatsapp');
    return data;
  },
  async conversa(numero: string): Promise<Conversa> {
    const { data } = await api.get<Conversa>(`/api/v1/conversas-whatsapp/${numero}`);
    return data;
  },
  async marcarLida(numero: string) {
    await api.post(`/api/v1/conversas-whatsapp/${numero}/lida`);
  },
  async responder(numero: string, texto: string) {
    const { data } = await api.post<{ resultado: string; motivo?: string }>(`/api/v1/conversas-whatsapp/${numero}/responder`, { texto });
    return data;
  },
  abrirMidia(item: ItemConversa) {
    return abrirBlob(item.origem === 'notificacao' ? `/api/v1/notificacoes-cobranca/${item.id}/pdf` : `/api/v1/conversas-whatsapp/midia/${item.id}`);
  },
  // Ferramenta de teste (homolog)
  async simularEntrada(numero: string, texto: string) {
    await api.post('/api/v1/dev/conversas-whatsapp/simular-entrada', { numero, texto });
  },
};
