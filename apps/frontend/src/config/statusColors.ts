// Mapeamento status de domínio -> cores visuais (Doc 3 §4 / Doc 4 §5.2).
// Regra 9 do CLAUDE.md: NUNCA hardcodar cor de status em componente — importar daqui.
// As chaves são os VALORES dos enums de @azit/types (rótulos de exibição).

export type StatusColor = {
  bg: string;
  fg: string;
};

export const PARCELA_STATUS_COLORS: Record<string, StatusColor> = {
  'Em aberto': { bg: '#f1f4f8', fg: '#8694a4' },
  'Vence hoje': { bg: '#fef6e9', fg: '#c98a0a' },
  Vencida: { bg: '#fef6e9', fg: '#c98a0a' },
  Paga: { bg: '#eafaf1', fg: '#1f9d5b' },
  'Paga em atraso': { bg: '#eafaf1', fg: '#1f9d5b' },
  'Paga antecipada': { bg: '#eafaf1', fg: '#1f9d5b' },
  Renegociada: { bg: '#efeaff', fg: '#6b4fd6' },
  Cancelada: { bg: '#fdeceb', fg: '#e0413c' },
  Estornada: { bg: '#fdeceb', fg: '#e0413c' },
  Suspensa: { bg: '#f1f4f8', fg: '#9aa7b5' },
};

export const FATURA_STATUS_COLORS: Record<string, StatusColor> = {
  Aberta: { bg: '#f1f4f8', fg: '#8694a4' },
  Fechada: { bg: '#eef1f5', fg: '#5b6b7f' },
  Vencida: { bg: '#fef6e9', fg: '#c98a0a' },
  Paga: { bg: '#eafaf1', fg: '#1f9d5b' },
  'Paga em atraso': { bg: '#eafaf1', fg: '#1f9d5b' },
  Renegociada: { bg: '#efeaff', fg: '#6b4fd6' },
};

// FASE do contrato (doc 02 §5.2, decisão 07/09 — três camadas): o badge de
// status é só a fase; a condição financeira usa SITUACAO_CONTRATO_COLORS e as
// intervenções (bloqueio/recuperação) viram selos próprios.
export const CONTRATO_STATUS_COLORS: Record<string, StatusColor> = {
  Rascunho: { bg: '#f1f4f8', fg: '#8694a4' },
  'Aguardando assinatura': { bg: '#f1f4f8', fg: '#8694a4' },
  'Aguardando pagamento inicial': { bg: '#fef6e9', fg: '#c98a0a' },
  'Aguardando entrega do veículo': { bg: '#fef6e9', fg: '#c98a0a' },
  Ativo: { bg: '#eafaf1', fg: '#1f9d5b' },
  Encerrado: { bg: '#f1f4f8', fg: '#5b6b7f' },
};

// Situação financeira do contrato — CALCULADA (Regra 7), chaves em lower_snake
// como o backend envia.
export const SITUACAO_CONTRATO_COLORS: Record<string, StatusColor> = {
  em_dia: { bg: '#eafaf1', fg: '#1f9d5b' },
  em_atraso: { bg: '#fdeceb', fg: '#e0413c' },
  em_acordo: { bg: '#eef4ff', fg: '#2456c7' },
};
export const SITUACAO_CONTRATO_LABEL: Record<string, string> = {
  em_dia: 'Em dia',
  em_atraso: 'Em atraso',
  em_acordo: 'Em acordo',
};

// Chaves = rótulos exibidos (A2, 04/09): antes as chaves não batiam com os
// labels da tela e todo badge de acordo caía no fallback cinza.
export const ACORDO_STATUS_COLORS: Record<string, StatusColor> = {
  'Aguardando aprovação': { bg: '#f1f4f8', fg: '#8694a4' },
  'Aguardando entrada': { bg: '#fef6e9', fg: '#c98a0a' },
  Ativo: { bg: '#eafaf1', fg: '#1f9d5b' },
  Quitado: { bg: '#eafaf1', fg: '#1f9d5b' },
  Cancelado: { bg: '#fdeceb', fg: '#e0413c' },
  Expirado: { bg: '#fdeceb', fg: '#e0413c' },
};

// Novação é mecanismo DISTINTO do acordo (Regra 5) — mapa próprio.
export const NOVACAO_STATUS_COLORS: Record<string, StatusColor> = {
  'Aguardando aprovação': { bg: '#f1f4f8', fg: '#8694a4' },
  Ativa: { bg: '#eafaf1', fg: '#1f9d5b' },
  Cancelada: { bg: '#fdeceb', fg: '#e0413c' },
};

// Status de Ativo (estoque, Bloco 7) — Doc 2 §4.4.
export const ATIVO_STATUS_COLORS: Record<string, StatusColor> = {
  Disponível: { bg: '#eafaf1', fg: '#1f9d5b' },
  'Em contrato': { bg: '#eef1f5', fg: '#5b6b7f' },
  Quitado: { bg: '#eafaf1', fg: '#1f9d5b' },
  Recuperado: { bg: '#f3eafb', fg: '#9a3bd1' },
  Sinistrado: { bg: '#fdeceb', fg: '#e0413c' },
};

// Status de Proposta (funil de originação, Bloco 7) — Doc 2 §4-A.4.
export const PROPOSTA_STATUS_COLORS: Record<string, StatusColor> = {
  Pendente: { bg: '#f1f4f8', fg: '#8694a4' },
  'Em análise': { bg: '#fef6e9', fg: '#c98a0a' },
  Aprovada: { bg: '#eafaf1', fg: '#1f9d5b' },
  Reprovada: { bg: '#fdeceb', fg: '#e0413c' },
  'Em formalização': { bg: '#eaf2fe', fg: '#2f6fde' },
  Convertida: { bg: '#ede9fb', fg: '#6b4fd6' },
  Cancelada: { bg: '#f1f4f8', fg: '#5b6b7f' },
};

// Estágios da régua de cobrança — Doc 3 §4.5. NÃO são status de entidade.
export const REGUA_STAGE_COLORS: Record<string, string> = {
  'D+1': '#e8920c',
  'D+2': '#e07a0c',
  'D+3': '#e0413c',
  'D+10': '#9a3bd1',
  'D+12': '#5b6b7f',
};

// Origens de capital — Doc 3 §4.6.
export const ORIGEM_CAPITAL_COLORS: Record<string, string> = {
  'Investidor de ativo específico': '#FA8E0D',
  'Fundo coletivo / exclusivo': '#6b4fd6',
  'Capital próprio Azit': '#1f9d5b',
  'Empréstimo / alavancagem': '#4f8af0',
};
