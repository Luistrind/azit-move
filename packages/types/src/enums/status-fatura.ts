// Status de Fatura — Doc 2 §5.3 / Doc 3 §4.2.
export enum StatusFatura {
  ABERTA         = 'Aberta',
  FECHADA        = 'Fechada',
  VENCIDA        = 'Vencida',
  PAGA           = 'Paga',
  PAGA_EM_ATRASO = 'Paga em atraso',
  RENEGOCIADA    = 'Renegociada',
}
