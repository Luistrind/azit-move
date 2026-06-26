// Tipo de OrigemCapital — Doc 2 §4.5 / Doc 5 §3 (TipoOrigemCapital).
export enum TipoOrigemCapital {
  CAPITAL_PROPRIO  = 'capital_proprio',
  EMPRESTIMO       = 'emprestimo',
  INVESTIDOR_ATIVO = 'investidor_ativo',
  FUNDO            = 'fundo',
}

export enum StatusOrigemCapital {
  ATIVO     = 'ativo',
  ENCERRADO = 'encerrado',
}
