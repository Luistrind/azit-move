// Mapeamento status de domínio -> cores visuais (Doc 3 §4 / Doc 4 §5.2).
// Regra 9 do CLAUDE.md: NUNCA hardcodar cor de status em componente — importar daqui.
// As chaves são os VALORES dos enums de @azit/types (rótulos de exibição).

export type StatusColor = {
  bg: string;
  fg: string;
};

export const PARCELA_STATUS_COLORS: Record<string, StatusColor> = {
  'Em aberto': { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  'Vence hoje': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  Vencida: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  Paga: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  'Paga em atraso': { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  'Paga antecipada': { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  Renegociada: { bg: 'var(--violet-bg)', fg: 'var(--violet-fg)' },
  Novada: { bg: 'var(--violet-bg)', fg: 'var(--violet-fg)' }, // obrigação extinta por novação (F2, 14/09)
  'Em acordo': { bg: 'var(--info-bg)', fg: 'var(--info-fg)' }, // parcela coberta (Vocabulário 07/09)
  Cancelada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  Estornada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  Suspensa: { bg: 'var(--surface-input)', fg: 'var(--text-muted)' },
};

// (FATURA_STATUS_COLORS por rótulo foi absorvido por FATURA_SITUACAO_COLORS
// abaixo — chaves lower_snake, como o backend envia a situação calculada.)

// FASE do contrato (doc 02 §5.2, decisão 07/09 — três camadas): o badge de
// status é só a fase; a condição financeira usa SITUACAO_CONTRATO_COLORS e as
// intervenções (bloqueio/recuperação) viram selos próprios.
export const CONTRATO_STATUS_COLORS: Record<string, StatusColor> = {
  Rascunho: { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  'Aguardando assinatura': { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  'Aguardando pagamento inicial': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  'Aguardando entrega do veículo': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  Ativo: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  Encerrado: { bg: 'var(--surface-input)', fg: 'var(--text-body)' },
};

// Situação financeira do contrato — CALCULADA (Regra 7), chaves em lower_snake
// como o backend envia.
export const SITUACAO_CONTRATO_COLORS: Record<string, StatusColor> = {
  em_dia: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  em_atraso: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  em_acordo: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
};
export const SITUACAO_CONTRATO_LABEL: Record<string, string> = {
  em_dia: 'Em dia',
  em_atraso: 'Em atraso',
  em_acordo: 'Em acordo',
};

// Chaves = rótulos exibidos (A2, 04/09): antes as chaves não batiam com os
// labels da tela e todo badge de acordo caía no fallback cinza.
export const ACORDO_STATUS_COLORS: Record<string, StatusColor> = {
  'Aguardando aprovação': { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  'Aguardando entrada': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  Ativo: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  Cumprido: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  Novado: { bg: 'var(--violet-bg)', fg: 'var(--violet-fg)' },
  Cancelado: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  Expirado: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};

// Novação é mecanismo DISTINTO do acordo (Regra 5) — mapa próprio.
export const NOVACAO_STATUS_COLORS: Record<string, StatusColor> = {
  'Aguardando aprovação': { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  'Aguardando assinatura': { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  'Aguardando recebimento': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  Ativa: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  Cancelada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  Expirada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};

// Status de Ativo (estoque, Bloco 7) — Doc 2 §4.4.
export const ATIVO_STATUS_COLORS: Record<string, StatusColor> = {
  Disponível: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  'Em contrato': { bg: 'var(--surface-muted)', fg: 'var(--text-body)' },
  Transferido: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' }, // Vocabulário 07/09: era Quitado
  Recuperado: { bg: 'var(--purple-bg)', fg: 'var(--purple-fg)' },
  Sinistrado: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};

// Status de Proposta (funil de originação, Bloco 7) — Doc 2 §4-A.4.
export const PROPOSTA_STATUS_COLORS: Record<string, StatusColor> = {
  Pendente: { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  'Em análise': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  Aprovada: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  Reprovada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  'Em formalização': { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  Convertida: { bg: 'var(--violet-bg)', fg: 'var(--violet-fg)' },
  Cancelada: { bg: 'var(--surface-input)', fg: 'var(--text-body)' },
};

// Estágios da régua de cobrança — Doc 3 §4.5. NÃO são status de entidade.
export const REGUA_STAGE_COLORS: Record<string, string> = {
  'D+1': 'var(--warn-fg)',
  'D+2': 'var(--warn-fg)',
  'D+3': 'var(--danger-fg)',
  'D+10': 'var(--purple-fg)',
  'D+12': 'var(--text-body)',
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
  em_aberto: { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  vence_hoje: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  vencida: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  paga: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  paga_em_atraso: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  renegociada: { bg: 'var(--violet-bg)', fg: 'var(--violet-fg)' },
  novada: { bg: 'var(--violet-bg)', fg: 'var(--violet-fg)' },
};
export const FATURA_SITUACAO_LABEL: Record<string, string> = {
  em_aberto: 'Em aberto',
  vence_hoje: 'Vence hoje',
  vencida: 'Vencida',
  paga: 'Paga',
  paga_em_atraso: 'Paga (em atraso)',
  renegociada: 'Renegociada',
  novada: 'Novada',
};

// Contas a Pagar (RF-15/18) — chaves = valores do enum StatusTituloPagar.
export const CONTAS_PAGAR_STATUS_COLORS: Record<string, StatusColor> = {
  SOLICITADO: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  EM_VALIDACAO: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  DEVOLVIDO: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  AGUARDANDO_APROVACAO: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  APROVADO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  PROGRAMADO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  ENVIADO_BPO: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  AGUARDANDO_CORA: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  PAGO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  CONCILIADO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  CANCELADO: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  BLOQUEADO: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  // Status de LOTE de pagamento (auditoria 15/09, Bloco D — o ciclo do lote
  // ficava monocromático no cinza default).
  EM_PREPARACAO: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  CADASTRADO_CORA: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  AGUARDANDO_APROVACAO_BANCO: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  APROVADO_BANCO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  PARCIALMENTE_PAGO: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
};

// Fornecedores (RF-16).
export const FORNECEDOR_STATUS_COLORS: Record<string, StatusColor> = {
  ATIVO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  AGUARDANDO_APROVACAO: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  EM_CADASTRO: { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  BLOQUEADO: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  INATIVO: { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
};

// Ciclo de vida do produto do Catálogo (doc 02 §17).
export const CATALOGO_CICLO_COLORS: Record<string, StatusColor> = {
  RASCUNHO: { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
  ATIVO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  SUSPENSO: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  ENCERRADO: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};

// Situação da CONTA na carteira (calculada) — em acordo = atraso coberto (07/09).
export const CONTA_SITUACAO_COLORS: Record<string, StatusColor> = {
  em_dia: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  em_atraso: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  em_acordo: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  bloqueada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};
export const CONTA_SITUACAO_LABEL: Record<string, string> = {
  em_dia: 'Em dia',
  em_atraso: 'Em atraso',
  em_acordo: 'Em acordo',
  bloqueada: 'Bloqueada',
};

// Situação da análise (alçada do analista / complemento / COCAD) — cor de texto.
export const ANALISE_SITUACAO_FG: Record<string, string> = {
  alcada: 'var(--ok-fg)',
  complemento: 'var(--warn-fg)',
  cocad: 'var(--danger-fg)',
};

// Desfecho da ocorrência (multa, IPVA, licenciamento) — doc 02 §25.3.
export const OCORRENCIA_STATUS_COLORS: Record<string, StatusColor> = {
  REGISTRADA: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  EM_RECURSO: { bg: 'var(--purple-bg)', fg: 'var(--purple-fg)' },
  AGUARDANDO_COMPROVANTE: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  REPASSADA: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  ASSUMIDA_AZIT: { bg: 'var(--surface-muted)', fg: 'var(--text-body)' },
  QUITADA: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  CANCELADA: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};

export const RESPONSAVEL_OCORRENCIA_COLORS: Record<string, StatusColor> = {
  CLIENTE: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  AZIT: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};

// Migração do legado (doc 02 §26): estado do caso e situação no Asaas.
export const CASO_LEGADO_STATUS_COLORS: Record<string, StatusColor> = {
  COLETADO: { bg: 'var(--surface-muted)', fg: 'var(--text-body)' },
  EM_REVISAO: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  VALIDADO: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  MIGRADO: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  DESCARTADO: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};
export const SITUACAO_LEGADO_COLORS: Record<string, StatusColor> = {
  SEM_VENCIDA: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  COM_VENCIDA: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  SEM_MOVIMENTO: { bg: 'var(--surface-muted)', fg: 'var(--text-body)' },
};
// Classe da cobrança lida do Asaas (paga / pendente / vencida / outra).
export const COBRANCA_LEGADA_COLORS: Record<string, StatusColor> = {
  paga: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  pendente: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  vencida: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  outra: { bg: 'var(--surface-muted)', fg: 'var(--text-body)' },
};

// Linha da conciliação do legado (doc 02 §26.7): esperado × cobrado × pago.
export const CONCILIACAO_LINHA_COLORS: Record<string, StatusColor> = {
  paga: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  paga_com_encargo: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  paga_por_acordo: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  em_acordo: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  pendente: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  vencida: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  nao_cobrada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  futura: { bg: 'var(--surface-muted)', fg: 'var(--text-body)' },
  valor_diverge: { bg: 'var(--purple-bg)', fg: 'var(--purple-fg)' },
};
// Confiança da linha (doc 02 §26.14): alta = nada a fazer; média = conferir; baixa = decidir.
export const CONFIANCA_LINHA_COLORS: Record<string, StatusColor> = {
  alta: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  media: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  baixa: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
};

// Central de Aprovações (doc 02 §7.9-A — lista e dossiê, 21/10/2026). Chaves =
// rótulos exibidos (como os demais mapas); os rótulos vêm dos enums de @azit/types.
export const APROVACAO_STATUS_LABEL: Record<string, string> = {
  PENDENTE: 'Pendente',
  APROVADA: 'Aprovada',
  REPROVADA: 'Reprovada',
  CANCELADA: 'Cancelada',
};
export const APROVACAO_STATUS_COLORS: Record<string, StatusColor> = {
  Pendente: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  Aprovada: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
  Reprovada: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  Cancelada: { bg: 'var(--surface-input)', fg: 'var(--text-label)' },
};

// De quem é a vez (VezAprovacao — calculada pelo backend para quem olha).
export const VEZ_APROVACAO_LABEL: Record<string, string> = {
  decidir: 'Sua vez',
  recomendar: 'Acima da sua alçada',
  responder_complemento: 'Responder complemento',
  aguardando_complemento: 'Aguardando complemento',
  voce_solicitou: 'Você solicitou',
  voce_decidiu: 'Você já decidiu',
};
export const VEZ_APROVACAO_COLORS: Record<string, StatusColor> = {
  'Sua vez': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  'Responder complemento': { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  'Acima da sua alçada': { bg: 'var(--surface-input)', fg: 'var(--text-body)' },
  'Aguardando complemento': { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  'Você solicitou': { bg: 'var(--surface-input)', fg: 'var(--text-body)' },
  'Você já decidiu': { bg: 'var(--surface-input)', fg: 'var(--text-body)' },
};

// Marcador da trilha da solicitação (decisões + complemento) — cor de texto.
export const TRILHA_APROVACAO_FG: Record<string, string> = {
  SOLICITADA: 'var(--navy)',
  APROVADA: 'var(--ok-fg)',
  RECOMENDADA: 'var(--warn-fg)',
  REPROVADA: 'var(--danger-fg)',
  COMPLEMENTO_PEDIDO: 'var(--info-fg)',
  COMPLEMENTO_RESPONDIDO: 'var(--text-body)',
};

// Tom de um valor no dossiê (atraso, comprometimento acima da política,
// espera acima de 2 dias…) — cor de texto.
export const TOM_DOSSIE_FG: Record<string, string> = {
  alerta: 'var(--danger-fg)',
  atencao: 'var(--warn-fg)',
  ok: 'var(--ok-fg)',
};

// Situação da ENTRADA do acordo e do RECEBIMENTO INICIAL da novação (calculadas
// pelo backend, chaves lower_snake) — cor de texto. Vieram de mapas locais da
// tela de Renegociações quando os blocos viraram componentes (21/10).
export const ENTRADA_ACORDO_FG: Record<string, string> = {
  sem_entrada: 'var(--text-muted)',
  paga: 'var(--ok-fg)',
  aguardando: 'var(--warn-fg)',
  aguardando_aprovacao: 'var(--text-muted)',
  expirada: 'var(--danger-fg)',
  nao_paga: 'var(--danger-fg)',
};
export const RECEBIMENTO_NOVACAO_FG: Record<string, string> = {
  sem_recebimento: 'var(--text-muted)',
  pago: 'var(--ok-fg)',
  aguardando: 'var(--warn-fg)',
  expirado: 'var(--danger-fg)',
  pendente: 'var(--text-muted)',
};

// Visão da carteira por período (doc 02 §27): estado da fatura no período e
// paleta ORDENADA de produtos. A linha de produto nasce do item da fatura, por
// isso a cor é por POSIÇÃO (1º produto por teto, 2º…), nunca por nome — produto
// novo recebe a próxima cor sem mexer aqui. Paleta validada (dataviz: CVD ≥ 8,
// contraste ≥ 3:1 nos dois temas); valores por tema via tokens --viz-*.
export const VISAO_ESTADO_COLORS: Record<'recebidas' | 'vencidas' | 'a_vencer', { fg: string; soft: string; rotulo: string }> = {
  recebidas: { fg: 'var(--viz-good)', soft: 'var(--viz-good-soft)', rotulo: 'Recebidas' },
  vencidas: { fg: 'var(--viz-bad)', soft: 'var(--viz-bad-soft)', rotulo: 'Vencidas' },
  a_vencer: { fg: 'var(--viz-warn)', soft: 'var(--viz-warn-soft)', rotulo: 'A vencer' },
};
export const PRODUTO_SLOT_COLORS: string[] = ['var(--viz-p1)', 'var(--viz-p2)', 'var(--viz-p3)', 'var(--viz-p4)', 'var(--viz-p5)', 'var(--viz-p6)'];
export const VIZ_NEUTRAL = 'var(--viz-neutral)';
