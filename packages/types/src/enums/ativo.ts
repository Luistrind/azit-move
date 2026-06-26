// Enums do Ativo — Doc 2 §4.4 / Doc 5 §3.
export enum TipoAtivo {
  VEICULO = 'veiculo',
  OUTRO   = 'outro',
}

export enum StatusAtivo {
  DISPONIVEL  = 'disponivel',
  EM_CONTRATO = 'em_contrato',
  QUITADO     = 'quitado',
  RECUPERADO  = 'recuperado',
  SINISTRADO  = 'sinistrado',
}

export enum TipoCombustivel {
  FLEX     = 'flex',
  GASOLINA = 'gasolina',
  ELETRICO = 'eletrico',
  DIESEL   = 'diesel',
  HIBRIDO  = 'hibrido',
}

export enum OrigemAtivo {
  LOCADORA       = 'locadora',
  PARTICULAR     = 'particular',
  CONCESSIONARIA = 'concessionaria',
}
