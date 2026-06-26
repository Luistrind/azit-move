// Status de Parcela — Doc 2 §5.1 / Doc 3 §4.1.
// Os três primeiros (EM_ABERTO, VENCE_HOJE, VENCIDA) são CALCULADOS em runtime
// pela função resolverStatusParcela (@azit/utils) comparando dataVencimento com hoje —
// NÃO são gravados no banco. O enum equivalente no Prisma contém só os armazenáveis.
// Os valores são os rótulos de exibição: statusColors.ts indexa por eles.
export enum StatusParcela {
  EM_ABERTO       = 'Em aberto',
  VENCE_HOJE      = 'Vence hoje',
  VENCIDA         = 'Vencida',
  PAGA            = 'Paga',
  PAGA_EM_ATRASO  = 'Paga em atraso',
  PAGA_ANTECIPADA = 'Paga antecipada',
  RENEGOCIADA     = 'Renegociada',
  CANCELADA       = 'Cancelada',
  ESTORNADA       = 'Estornada',
  SUSPENSA        = 'Suspensa',
}

// Subconjunto efetivamente persistido (espelha o enum StatusParcela do Prisma).
export const STATUS_PARCELA_ARMAZENAVEIS = [
  StatusParcela.PAGA,
  StatusParcela.PAGA_EM_ATRASO,
  StatusParcela.PAGA_ANTECIPADA,
  StatusParcela.RENEGOCIADA,
  StatusParcela.CANCELADA,
  StatusParcela.ESTORNADA,
  StatusParcela.SUSPENSA,
] as const;

// Estados calculados em runtime — nunca gravados.
export const STATUS_PARCELA_CALCULADOS = [
  StatusParcela.EM_ABERTO,
  StatusParcela.VENCE_HOJE,
  StatusParcela.VENCIDA,
] as const;
