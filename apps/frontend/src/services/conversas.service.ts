import { api } from '../lib/api';

// Conversas do WhatsApp (doc 02 §24): respostas dos clientes ao número
// dedicado, atendidas no sistema.

export interface ResumoConversa {
  numero: string; // canônico: 55 + DDD + celular com o nono dígito
  titular: { id: string; nome: string } | null;
  nomePerfil: string | null;
  ultimaEm: string | null;
  ultimaDirecao: 'ENTRADA' | 'SAIDA' | null;
  ultimaPrevia: string;
  naoLidas: number;
}

export interface ItemConversa {
  id: string;
  origem: 'mensagem' | 'lembrete';
  direcao: 'ENTRADA' | 'SAIDA';
  momento: string;
  tipo: string; // mensagem: text | image | …; lembrete: D_MENOS_2 | D_ZERO
  texto: string | null;
  temMidia: boolean;
  midiaDisponivel: boolean;
  midiaNome: string | null;
  // mensagem de saída: enviando | enviada | entregue | lida | falhou | simulada | retida
  // lembrete: ENVIADO | ENTREGUE | LIDO | SIMULADO
  situacao: string | null;
  motivo: string | null;
  autor: string | null;
  lida: boolean;
}

export interface Conversa {
  numero: string;
  titular: { id: string; nome: string } | null;
  nomePerfil: string | null;
  contratos: { id: string; numero: string; ativo: { placa: string | null; modelo: string | null } | null }[];
  janela: { aberta: boolean; ate: string | null; horas: number };
  envio: { producao: boolean; decisao: string; motivo: string | null; enviaDeVerdade: boolean };
  itens: ItemConversa[];
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
  async marcarLida(numero: string): Promise<void> {
    await api.post(`/api/v1/conversas-whatsapp/${numero}/lida`);
  },
  async responder(numero: string, texto: string): Promise<{ resultado: 'enviada' | 'simulada' | 'retida' | 'falhou'; motivo?: string }> {
    const { data } = await api.post(`/api/v1/conversas-whatsapp/${numero}/responder`, { texto });
    return data;
  },
  async abrirMidia(item: ItemConversa): Promise<void> {
    const resp = await api.get(`/api/v1/conversas-whatsapp/midia/${item.id}`, { responseType: 'blob' });
    const u = URL.createObjectURL(resp.data as Blob);
    window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  },
  // Ferramenta de teste (fora de produção)
  async simularEntrada(numero: string, texto: string): Promise<void> {
    await api.post('/api/v1/dev/conversas-whatsapp/simular-entrada', { numero, texto });
  },
};
