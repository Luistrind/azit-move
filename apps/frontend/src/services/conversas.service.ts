import type { EtiquetaContato, TipoMidiaSaidaWhatsapp } from '@azit/types';
import { api } from '../lib/api';

// Conversas do WhatsApp (doc 02 §24 e §34): o atendimento do número oficial —
// clientes, ex-clientes e leads — no sistema.

export interface ResumoConversa {
  numero: string; // canônico: 55 + DDD + celular com o nono dígito
  titular: { id: string; nome: string } | null;
  lead: { id: string; nome: string } | null;
  nomePerfil: string | null;
  etiqueta: EtiquetaContato;
  ultimaEm: string | null; // última atividade: mensagem OU lembrete (§34.2)
  ultimaOrigem: 'mensagem' | 'lembrete' | null;
  ultimaDirecao: 'ENTRADA' | 'SAIDA' | null;
  ultimaPrevia: string;
  naoLidas: number;
  respondeu: boolean; // o contato já mandou alguma mensagem
}

export interface ItemConversa {
  id: string;
  origem: 'mensagem' | 'lembrete';
  direcao: 'ENTRADA' | 'SAIDA';
  momento: string;
  tipo: string; // mensagem: text | image | audio | document …; lembrete: D_MENOS_2 | D_ZERO | D_MAIS_2
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

export interface SimulacaoDoContato {
  id: string;
  criadaEm: string;
  validaAte: string | null;
  veiculo: string;
  valorAvista: number;
  oferta: { valorEntrada: number; prazoMeses: number | null; frequencia: string; valorParcela: number } | null;
  propostaId: string | null;
}

export interface Conversa {
  numero: string;
  titular: { id: string; nome: string } | null;
  contaId: string | null;
  lead: { id: string; nome: string; cpf: string | null; canalOrigem: string; criadoEm: string } | null;
  nomePerfil: string | null;
  etiqueta: EtiquetaContato;
  respondeu: boolean;
  contratos: { id: string; numero: string; ativo: { placa: string | null; modelo: string | null } | null }[];
  historico: { id: string; numero: string; status: string; motivoEncerramento: string | null; dataEncerramento: string | null; ativo: string | null }[];
  simulacoes: SimulacaoDoContato[];
  janela: { aberta: boolean; ate: string | null; horas: number };
  envio: { producao: boolean; decisao: string; motivo: string | null; enviaDeVerdade: boolean };
  itens: ItemConversa[];
}

export type ResultadoSaida = { resultado: 'enviada' | 'simulada' | 'retida' | 'falhou'; motivo?: string };

// §34.7: linhas que a tela recebeu do serviço da simulação, para o PDF.
export interface DocumentoSimulacaoEnvio {
  titulo: string;
  destaque?: { rotulo: string; valor: string } | null;
  linhas: { rotulo: string; valor: string }[];
  observacoes?: string[];
}

export const conversasService = {
  async listar(): Promise<ResumoConversa[]> {
    const { data } = await api.get<ResumoConversa[]>('/api/v1/conversas-whatsapp');
    return data;
  },
  // Contador do menu.
  async naoLidas(): Promise<number> {
    const { data } = await api.get<{ total: number }>('/api/v1/conversas-whatsapp/nao-lidas');
    return data.total;
  },
  async conversa(numero: string): Promise<Conversa> {
    const { data } = await api.get<Conversa>(`/api/v1/conversas-whatsapp/${numero}`);
    return data;
  },
  async marcarLida(numero: string): Promise<void> {
    await api.post(`/api/v1/conversas-whatsapp/${numero}/lida`);
  },
  async responder(numero: string, texto: string): Promise<ResultadoSaida> {
    const { data } = await api.post(`/api/v1/conversas-whatsapp/${numero}/responder`, { texto });
    return data;
  },
  // Imagem, documento ou áudio gravado (§34.6). O arquivo vai em base64, como nos outros uploads.
  async enviarAnexo(numero: string, body: { tipo: TipoMidiaSaidaWhatsapp; nome: string; mime: string; conteudoBase64: string; legenda?: string }): Promise<ResultadoSaida> {
    const { data } = await api.post(`/api/v1/conversas-whatsapp/${numero}/anexo`, body, { timeout: 120_000 });
    return data;
  },
  // Resultado de simulação do painel: texto sempre, PDF opcional (§34.7).
  async enviarSimulacao(numero: string, body: { texto: string; pdf?: DocumentoSimulacaoEnvio | null }): Promise<{ pdf: ResultadoSaida | null; texto: ResultadoSaida }> {
    const { data } = await api.post(`/api/v1/conversas-whatsapp/${numero}/simulacao`, body, { timeout: 120_000 });
    return data;
  },
  async abrirMidia(item: ItemConversa): Promise<void> {
    const resp = await api.get(`/api/v1/conversas-whatsapp/midia/${item.id}`, { responseType: 'blob' });
    const u = URL.createObjectURL(resp.data as Blob);
    window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  },
  // Para tocar o áudio dentro da bolha (sem abrir outra aba).
  async urlMidia(id: string): Promise<string> {
    const resp = await api.get(`/api/v1/conversas-whatsapp/midia/${id}`, { responseType: 'blob' });
    return URL.createObjectURL(resp.data as Blob);
  },
  // Ferramenta de teste (fora de produção)
  async simularEntrada(numero: string, texto: string): Promise<void> {
    await api.post('/api/v1/dev/conversas-whatsapp/simular-entrada', { numero, texto });
  },
};

// Lê um File/Blob como data URL (base64) para o envio.
export function lerComoBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Não foi possível ler o arquivo'));
    r.readAsDataURL(arquivo);
  });
}
