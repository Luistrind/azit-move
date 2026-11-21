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

// Custos da recuperação do veículo (doc 02 §29.3, decisão Luís 20/11/2026). Lista
// única dos tipos — backend valida, tela e dossiê exibem daqui. O custo é um
// lançamento de custo do veículo ligado ao contrato.
export const TIPOS_CUSTO_RECUPERACAO = [
  'retomada',
  'guincho',
  'patio',
  'chave',
  'avaria',
  'pneu',
  'rastreador',
  'limpeza',
  'documento',
  'juridico',
  'outro',
] as const;
export type TipoCustoRecuperacao = (typeof TIPOS_CUSTO_RECUPERACAO)[number];

export const TIPO_CUSTO_RECUPERACAO_LABEL: Record<TipoCustoRecuperacao, string> = {
  retomada: 'Retomada (equipe)',
  guincho: 'Guincho / transporte',
  patio: 'Pátio / diárias',
  chave: 'Chave / chaveiro',
  avaria: 'Avaria / reparo',
  pneu: 'Pneu / roda',
  rastreador: 'Rastreador',
  limpeza: 'Limpeza / higienização',
  documento: 'Documento / despachante',
  juridico: 'Custas e honorários',
  outro: 'Outro',
};

export enum SituacaoCusto {
  ORCADO = 'orcado',
  PAGO   = 'pago',
}

export enum QuemPagaCusto {
  CLIENTE = 'cliente',
  AZIT    = 'azit',
}

// Como o carro voltou na rescisão (doc 02 §29.3).
export enum OrigemRescisao {
  RETOMADA  = 'retomada',
  DEVOLUCAO = 'devolucao',
}
