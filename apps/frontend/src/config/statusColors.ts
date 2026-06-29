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

export const CONTRATO_STATUS_COLORS: Record<string, StatusColor> = {
  Rascunho: { bg: '#f1f4f8', fg: '#8694a4' },
  'Aguardando assinatura': { bg: '#f1f4f8', fg: '#8694a4' },
  'Aguardando pagamento inicial': { bg: '#fef6e9', fg: '#c98a0a' },
  'Aguardando entrega do veículo': { bg: '#fef6e9', fg: '#c98a0a' },
  Ativo: { bg: '#eafaf1', fg: '#1f9d5b' },
  Inadimplente: { bg: '#fef6e9', fg: '#c98a0a' },
  Bloqueado: { bg: '#fdeceb', fg: '#e0413c' },
  Suspenso: { bg: '#f1f4f8', fg: '#9aa7b5' },
  'Em recuperação de veículo': { bg: '#f3eafb', fg: '#9a3bd1' },
  Cancelado: { bg: '#fdeceb', fg: '#e0413c' },
  Rescindido: { bg: '#f1f4f8', fg: '#5b6b7f' },
  'Quitado (aguardando transferência)': { bg: '#eafaf1', fg: '#1f9d5b' },
  'Quitado (transferência efetivada)': { bg: '#eafaf1', fg: '#1f9d5b' },
};

export const ACORDO_STATUS_COLORS: Record<string, StatusColor> = {
  Rascunho: { bg: '#f1f4f8', fg: '#8694a4' },
  Ativo: { bg: '#fef6e9', fg: '#c98a0a' },
  Quitado: { bg: '#eafaf1', fg: '#1f9d5b' },
  Cancelado: { bg: '#fdeceb', fg: '#e0413c' },
};

// Status de Proposta (funil de originação, Bloco 7) — Doc 2 §4-A.4.
export const PROPOSTA_STATUS_COLORS: Record<string, StatusColor> = {
  Pendente: { bg: '#f1f4f8', fg: '#8694a4' },
  'Em análise': { bg: '#fef6e9', fg: '#c98a0a' },
  Aprovada: { bg: '#eafaf1', fg: '#1f9d5b' },
  Reprovada: { bg: '#fdeceb', fg: '#e0413c' },
  'Em formalização': { bg: '#eef1f5', fg: '#5b6b7f' },
  Convertida: { bg: '#efeaff', fg: '#6b4fd6' },
  Cancelada: { bg: '#fdeceb', fg: '#e0413c' },
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
