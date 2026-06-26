// Enums da camada do titular — Doc 2 §4.1, §4.3 / Doc 5 §3.
export enum TipoPessoa {
  PF = 'pf',
  PJ = 'pj',
}

export enum StatusTitular {
  ATIVO     = 'ativo',
  INATIVO   = 'inativo',
  BLOQUEADO = 'bloqueado',
}

export enum StatusConta {
  ATIVA     = 'ativa',
  SUSPENSA  = 'suspensa',
  ENCERRADA = 'encerrada',
}
