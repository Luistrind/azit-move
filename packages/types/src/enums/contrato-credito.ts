// Enums transversais ao ContratoCredito e à cesta — Doc 2 §4.7–§4.12 / Doc 5 §3.
export enum Periodicidade {
  SEMANAL   = 'semanal',
  QUINZENAL = 'quinzenal',
  MENSAL    = 'mensal',
}

export enum MotivoEncerramento {
  QUITACAO     = 'quitacao',
  RESCISAO     = 'rescisao',
  CANCELAMENTO = 'cancelamento',
}

export enum NaturezaProduto {
  RECORRENTE = 'recorrente',
  PARCELADO  = 'parcelado',
}

export enum Credor {
  AZIT       = 'azit',
  INVESTIDOR = 'investidor',
  TERCEIRO   = 'terceiro',
}

export enum StatusItemContratado {
  ATIVO     = 'ativo',
  ENCERRADO = 'encerrado',
  CANCELADO = 'cancelado',
}

export enum TipoItemFatura {
  PRINCIPAL    = 'principal',
  INTERMEDIARIA = 'intermediaria', // parcela-balão da entrada parcelada
  SERVICO      = 'servico',
  ENCARGO      = 'encargo',
}

export enum StatusRecebivel {
  ESPERADO    = 'esperado',
  REALIZADO   = 'realizado',
  RENEGOCIADO = 'renegociado',
  CANCELADO   = 'cancelado',
}

export enum StatusReajuste {
  PENDENTE  = 'pendente',
  APROVADO  = 'aprovado',
  APLICADO  = 'aplicado',
  CANCELADO = 'cancelado',
}
