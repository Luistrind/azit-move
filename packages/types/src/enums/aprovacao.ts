// Motor de aprovação unificado — Doc 2 §7.9-A. Valores = os que a API envia
// (enums do Prisma em MAIÚSCULAS; a vez é calculada em minúsculas).
export enum StatusAprovacao {
  PENDENTE  = 'PENDENTE',
  APROVADA  = 'APROVADA',
  REPROVADA = 'REPROVADA',
  CANCELADA = 'CANCELADA',
}

export enum DecisaoAprovacao {
  APROVADA    = 'APROVADA',
  RECOMENDADA = 'RECOMENDADA', // endosso de quem não tem alçada — escala
  REPROVADA   = 'REPROVADA',
}

// De quem é a vez numa solicitação PENDENTE, do ponto de vista de quem olha
// (Central de Aprovações, 21/10/2026). Situação CALCULADA (Regra 7) — não é gravada.
export enum VezAprovacao {
  DECIDIR                = 'decidir',
  RECOMENDAR             = 'recomendar',
  RESPONDER_COMPLEMENTO  = 'responder_complemento',
  AGUARDANDO_COMPLEMENTO = 'aguardando_complemento',
  VOCE_SOLICITOU         = 'voce_solicitou',
  VOCE_DECIDIU           = 'voce_decidiu',
}
