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
  'Em acordo': { bg: '#eef4ff', fg: '#2456c7' }, // parcela coberta (Vocabulário 07/09)
  Cancelada: { bg: '#fdeceb', fg: '#e0413c' },
  Estornada: { bg: '#fdeceb', fg: '#e0413c' },
  Suspensa: { bg: '#f1f4f8', fg: '#9aa7b5' },
};

// (FATURA_STATUS_COLORS por rótulo foi absorvido por FATURA_SITUACAO_COLORS
// abaixo — chaves lower_snake, como o backend envia a situação calculada.)

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
  Cumprido: { bg: '#eafaf1', fg: '#1f9d5b' },
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
  Transferido: { bg: '#eafaf1', fg: '#1f9d5b' }, // Vocabulário 07/09: era Quitado
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

// ============================================================
// Padronização E1 (07/09): TODOS os mapas de cor de status vivem AQUI (Regra 9),
// na paleta canônica (verde #eafaf1/#1f9d5b · âmbar #fef6e9/#c98a0a · vermelho
// #fdeceb/#e0413c · neutro #f1f4f8/#8694a4 · cinza #eef1f5/#5b6b7f · azul
// #eef4ff/#2456c7). Os mapas locais por página foram absorvidos.
// ============================================================

// Situação da FATURA calculada em runtime (Regra 7) — chaves lower_snake como o
// backend envia. Vencida é VERMELHA (padrão de atraso de todo o sistema).
export const FATURA_SITUACAO_COLORS: Record<string, StatusColor> = {
  em_aberto: { bg: '#f1f4f8', fg: '#8694a4' },
  vence_hoje: { bg: '#fef6e9', fg: '#c98a0a' },
  vencida: { bg: '#fdeceb', fg: '#e0413c' },
  paga: { bg: '#eafaf1', fg: '#1f9d5b' },
  paga_em_atraso: { bg: '#eafaf1', fg: '#1f9d5b' },
  renegociada: { bg: '#efeaff', fg: '#6b4fd6' },
};
export const FATURA_SITUACAO_LABEL: Record<string, string> = {
  em_aberto: 'Em aberto',
  vence_hoje: 'Vence hoje',
  vencida: 'Vencida',
  paga: 'Paga',
  paga_em_atraso: 'Paga (em atraso)',
  renegociada: 'Renegociada',
};

// Contas a Pagar (RF-15/18) — chaves = valores do enum StatusTituloPagar.
export const CONTAS_PAGAR_STATUS_COLORS: Record<string, StatusColor> = {
  SOLICITADO: { bg: '#eef4ff', fg: '#2456c7' },
  EM_VALIDACAO: { bg: '#eef4ff', fg: '#2456c7' },
  DEVOLVIDO: { bg: '#fef6e9', fg: '#c98a0a' },
  AGUARDANDO_APROVACAO: { bg: '#fef6e9', fg: '#c98a0a' },
  APROVADO: { bg: '#eafaf1', fg: '#1f9d5b' },
  PROGRAMADO: { bg: '#eafaf1', fg: '#1f9d5b' },
  ENVIADO_BPO: { bg: '#eef4ff', fg: '#2456c7' },
  AGUARDANDO_CORA: { bg: '#fef6e9', fg: '#c98a0a' },
  PAGO: { bg: '#eafaf1', fg: '#1f9d5b' },
  CONCILIADO: { bg: '#eafaf1', fg: '#1f9d5b' },
  CANCELADO: { bg: '#fdeceb', fg: '#e0413c' },
  BLOQUEADO: { bg: '#fdeceb', fg: '#e0413c' },
};

// Fornecedores (RF-16).
export const FORNECEDOR_STATUS_COLORS: Record<string, StatusColor> = {
  ATIVO: { bg: '#eafaf1', fg: '#1f9d5b' },
  AGUARDANDO_APROVACAO: { bg: '#fef6e9', fg: '#c98a0a' },
  EM_CADASTRO: { bg: '#f1f4f8', fg: '#8694a4' },
  BLOQUEADO: { bg: '#fdeceb', fg: '#e0413c' },
  INATIVO: { bg: '#f1f4f8', fg: '#8694a4' },
};

// Ciclo de vida do produto do Catálogo (doc 02 §17).
export const CATALOGO_CICLO_COLORS: Record<string, StatusColor> = {
  RASCUNHO: { bg: '#f1f4f8', fg: '#8694a4' },
  ATIVO: { bg: '#eafaf1', fg: '#1f9d5b' },
  SUSPENSO: { bg: '#fef6e9', fg: '#c98a0a' },
  ENCERRADO: { bg: '#fdeceb', fg: '#e0413c' },
};

// Situação da CONTA na carteira (calculada) — em acordo = atraso coberto (07/09).
export const CONTA_SITUACAO_COLORS: Record<string, StatusColor> = {
  em_dia: { bg: '#eafaf1', fg: '#1f9d5b' },
  em_atraso: { bg: '#fdeceb', fg: '#e0413c' },
  em_acordo: { bg: '#eef4ff', fg: '#2456c7' },
  bloqueada: { bg: '#fdeceb', fg: '#e0413c' },
};
export const CONTA_SITUACAO_LABEL: Record<string, string> = {
  em_dia: 'Em dia',
  em_atraso: 'Em atraso',
  em_acordo: 'Em acordo',
  bloqueada: 'Bloqueada',
};

// Situação da análise (alçada do analista / complemento / COCAD) — cor de texto.
export const ANALISE_SITUACAO_FG: Record<string, string> = {
  alcada: '#1f9d5b',
  complemento: '#c98a0a',
  cocad: '#e0413c',
};
