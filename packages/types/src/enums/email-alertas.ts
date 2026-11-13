// Alertas por e-mail (doc 06 v1.1 §12) — constantes ÚNICAS para API e tela.

// Chave em `Usuario.preferencias` (JSON). Ausente = ligado (§12.3 item 4).
export const CHAVE_PREFERENCIA_EMAIL_ALERTAS = 'emailAlertas';

// O que chega por e-mail (texto de "Minha conta"). Só notificação DIRIGIDA a
// um usuário, nos eventos da §12.2 — nada por área, nada geral.
export const EVENTOS_ALERTA_EMAIL = [
  'Aprovação esperando por você (quando a sua alçada cobre a operação)',
  'Pedido de complemento numa solicitação sua',
  'Resposta a um complemento que você pediu',
  'Decisão sobre uma solicitação sua (aprovada, não aprovada ou recomendada)',
] as const;

// Situação do e-mail de uma notificação (rótulos de tela — chave do mapa de cores).
export const ROTULO_EMAIL_NOTIFICACAO = {
  enviado: 'E-mail enviado',
  naoEnviado: 'Não enviado',
  semEmail: 'Só no sino',
} as const;

// Motivos de "não enviado" gravados em `Notificacao.emailFalha` (códigos) e
// como a tela os lê. Códigos fora do mapa aparecem como vieram (falha do Gmail).
export const MOTIVO_EMAIL_LEGIVEL: Record<string, string> = {
  email_nao_configurado: 'e-mail não configurado no servidor',
  descartado_ja_lida: 'descartado: a pessoa já tinha lido no sino',
  descartado_ja_decidiu: 'descartado: a pessoa já tinha decidido',
  descartado_aprovacao_encerrada: 'descartado: a solicitação já tinha sido decidida',
  destinatario_sem_email: 'destinatário sem e-mail',
};

export function motivoEmailLegivel(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MOTIVO_EMAIL_LEGIVEL[motivo] ?? motivo;
}

// Caminho de envio ativo (EMAIL_TRANSPORTE) — nome por extenso para a tela.
export const NOME_TRANSPORTE_EMAIL: Record<string, string> = {
  'smtp-relay': 'Relay SMTP do Workspace',
  'gmail-api': 'API do Gmail (conta de serviço)',
  nenhum: 'Nenhum',
  duble: 'Dublê de teste',
};

// Estado de um job da fila `email` como a Central de integrações mostra.
export const ROTULO_ESTADO_ENVIO_EMAIL = {
  enviado: 'Enviado',
  falhou: 'Falhou',
  descartado: 'Descartado',
  naoConfigurado: 'Não configurado',
  aguardando: 'Aguardando',
  tentando: 'Tentando de novo',
} as const;
export type EstadoEnvioEmail = keyof typeof ROTULO_ESTADO_ENVIO_EMAIL;
