import { api } from '../lib/api';

// Dossiê para cobrança judicial (doc 02 §30): o operador manda só as capturas
// do WhatsApp (e, se tiver, notificação/Infleet em PDF); o backend monta o PDF.
export interface Dossie {
  id: string;
  contratoId: string;
  geradoEm: string;
  geradoPor: string | null;
  paginas: number;
  capturas: number;
  tamanho: number; // bytes
  secoes: { chave: string; titulo: string; paginaInicial: number; paginas: number }[];
  avisos: string[];
  observacao: string | null;
  arquivo: string;
}

export interface ParametrosEmpresa {
  contratoSocial: { nome: string | null; descricao: string; em: string | null } | null;
}

export function lerComoDataUrl(file: File): Promise<string> {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export const dossieService = {
  async enviarArquivo(contratoId: string, tipo: 'captura' | 'notificacao' | 'infleet', file: File): Promise<{ id: string; nome: string }> {
    const conteudo = await lerComoDataUrl(file);
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/dossie/arquivos`, { tipo, nome: file.name, conteudo });
    return data;
  },
  async gerar(contratoId: string, body: { capturas: string[]; notificacaoId?: string; infleetId?: string; infleetDescricao?: string; observacao?: string }): Promise<Dossie> {
    const { data } = await api.post<Dossie>(`/api/v1/contratos/${contratoId}/dossie`, body);
    return data;
  },
  async listar(contratoId: string): Promise<Dossie[]> {
    const { data } = await api.get<Dossie[]>(`/api/v1/contratos/${contratoId}/dossies`);
    return data;
  },
  async abrirPdf(dossieId: string): Promise<void> {
    const resp = await api.get(`/api/v1/dossies/${dossieId}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([resp.data as Blob], { type: 'application/pdf' }));
    window.open(url, '_blank');
  },
  async parametrosEmpresa(): Promise<ParametrosEmpresa> {
    const { data } = await api.get<ParametrosEmpresa>('/api/v1/empresa/parametros');
    return data;
  },
  async salvarContratoSocial(file: File, descricao: string): Promise<ParametrosEmpresa> {
    const conteudo = await lerComoDataUrl(file);
    const { data } = await api.post<ParametrosEmpresa>('/api/v1/empresa/contrato-social', { nome: file.name, conteudo, descricao });
    return data;
  },
  async abrirContratoSocial(): Promise<void> {
    const resp = await api.get('/api/v1/empresa/contrato-social/pdf', { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([resp.data as Blob], { type: 'application/pdf' }));
    window.open(url, '_blank');
  },
};
