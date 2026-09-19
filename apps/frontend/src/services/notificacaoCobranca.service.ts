import { api } from '../lib/api';

// Notificações formais de cobrança — POP-COB-001 (doc 02 §23). Valores em centavos.

export type StatusNotificacao = 'PREPARADA' | 'ENVIADA' | 'ENTREGUE' | 'LIDA' | 'FALHOU' | 'SIMULADA';

export interface NotificacaoCobranca {
  id: string;
  etapa: number;
  titulo: string;
  assunto: string;
  status: StatusNotificacao;
  statusRotulo: string;
  disparo: 'automatico' | 'manual';
  destino: string | null;
  provedor: string | null;
  mensagemId: string | null;
  tentativas: number;
  enviadaEm: string | null;
  entregueEm: string | null;
  lidaEm: string | null;
  falhaEm: string | null;
  falhaMotivo: string | null;
  textoSha256: string;
  pdfSha256: string | null;
  temPdf: boolean;
  eventos: { em: string; tipo: string; detalhe?: string }[];
}

export interface ProximaNotificacao {
  etapa: number;
  prevista: string | null; // null = depende de um evento
  condicao: string;
}

export interface PainelNotificacoes {
  elegivel: boolean;
  disparoAutomatico: boolean;
  // producao=false: só os números autorizados do ambiente recebem de verdade.
  provedor: { simulado: boolean; disponivel: boolean; producao: boolean; numerosTeste: number };
  estado: {
    casoAberto: boolean;
    parcelasVencidas: number;
    diasAtraso: number;
    valorAtualizado: number;
    fase: string;
    ultimaEtapa: number | null;
    proxima: ProximaNotificacao | null;
    monitorarVeiculo: boolean;
    bloqueioLiberado: boolean;
    bloqueioLiberadoEm: string | null;
    rescisaoSinalizada: boolean;
    podeEnviarRescisao: boolean;
  } | null;
  intervencoes: {
    bloqueadoEm: string | null;
    retomadoEm: string | null;
    retomada: { local?: string; responsavel?: string; condicoes?: string; observacoes?: string | null; devolvidoEm?: string; motivoDevolucao?: string } | null;
    juridicoEm: string | null;
  };
  // Conversa do WhatsApp do titular (doc 02 §24).
  conversa: { numero: string | null; total: number; naoLidas: number };
  casos: {
    id: string;
    abertoEm: string;
    encerradoEm: string | null;
    motivoEncerramento: string | null;
    notificacoes: NotificacaoCobranca[];
  }[];
}

export interface TextoEtapa {
  subtitulo: string;
  assunto: string;
  texto: string;
  personalizado: boolean;
}

export interface ParametrosNotificacao {
  ativo: boolean;
  modeloNome: string;
  modeloIdioma: string;
  textos: Record<string, TextoEtapa>;
  variaveis: { chave: string; descricao: string }[];
  etapas: Record<string, { titulo: string; resumo: string; anexo: string }>;
  provedor: { configurado: boolean; simulado: boolean; producao: boolean };
  janela: string;
  numerosTeste: string[];
}

function abrirPdf(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const notificacaoCobrancaService = {
  async painel(contratoId: string): Promise<PainelNotificacoes> {
    const { data } = await api.get<PainelNotificacoes>(`/api/v1/contratos/${contratoId}/notificacoes-cobranca`);
    return data;
  },
  async abrirPdf(notificacaoId: string) {
    const resp = await api.get(`/api/v1/notificacoes-cobranca/${notificacaoId}/pdf`, { responseType: 'blob' });
    abrirPdf(resp.data as Blob);
  },
  async baixarDossie(contratoId: string, numero: string) {
    const resp = await api.get(`/api/v1/contratos/${contratoId}/notificacoes-cobranca/dossie`, { responseType: 'blob' });
    baixar(resp.data as Blob, `dossie-notificacoes-contrato-${numero}.pdf`);
  },
  async reenviar(notificacaoId: string) {
    const { data } = await api.post<{ resultado: string; motivo?: string }>(`/api/v1/notificacoes-cobranca/${notificacaoId}/reenviar`);
    return data;
  },
  async registrarRetomada(contratoId: string, body: { dataHora?: string; local: string; responsavel: string; condicoes: string; observacoes?: string }) {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/retomada`, body);
    return data as { resultado: string; quinta: string };
  },
  async devolverVeiculo(contratoId: string, motivo: string) {
    await api.post(`/api/v1/contratos/${contratoId}/retomada/devolver`, { motivo });
  },
  async juridico(contratoId: string, encaminhar: boolean, motivo?: string) {
    await api.post(`/api/v1/contratos/${contratoId}/juridico`, { encaminhar, motivo });
  },
  async enviarRescisao(contratoId: string) {
    const { data } = await api.post<{ resultado: string; motivo?: string }>(`/api/v1/contratos/${contratoId}/notificacoes-cobranca/rescisao`);
    return data;
  },
  // Configurações
  async parametros(): Promise<ParametrosNotificacao> {
    const { data } = await api.get<ParametrosNotificacao>('/api/v1/notificacoes-cobranca/parametros');
    return data;
  },
  async salvarParametros(body: { ativo?: boolean; modeloNome?: string; modeloIdioma?: string; textos?: Record<string, { subtitulo?: string; assunto: string; texto: string } | null>; numerosTeste?: string[] }) {
    const { data } = await api.put<ParametrosNotificacao>('/api/v1/notificacoes-cobranca/parametros', body);
    return data;
  },
  async previa(etapa: number, modelo: { subtitulo?: string; assunto?: string; texto?: string }) {
    const resp = await api.post(`/api/v1/notificacoes-cobranca/previa/${etapa}`, modelo, { responseType: 'blob' });
    abrirPdf(resp.data as Blob);
  },
  // Ferramentas de teste (homolog)
  async varrerTeste() {
    const { data } = await api.post('/api/v1/dev/notificacoes-cobranca/varrer', { ignorarJanela: true });
    return data as { contratos: number; casosAbertos: number; casosEncerrados: number; enfileirados: number; retidas: number; disparoAutomatico: boolean };
  },
  async avancarRelogio(contratoId: string, horas: number) {
    await api.post(`/api/v1/dev/contratos/${contratoId}/notificacoes-cobranca/avancar`, { horas });
  },
  async simularStatus(notificacaoId: string, status: 'delivered' | 'read') {
    await api.post(`/api/v1/dev/notificacoes-cobranca/${notificacaoId}/simular-status`, { status });
  },
};
