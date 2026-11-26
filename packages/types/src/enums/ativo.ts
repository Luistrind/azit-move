// Enums do Ativo — Doc 2 §4.4 / Doc 5 §3.
export enum TipoAtivo {
  VEICULO = 'veiculo',
  OUTRO   = 'outro',
}

export enum StatusAtivo {
  DISPONIVEL    = 'disponivel',
  EM_PREPARACAO = 'em_preparacao', // checklist antes da venda (doc 02 §25.8)
  RESERVADO     = 'reservado', // preso a uma proposta da lista de espera (doc 02 §31.4)
  EM_CONTRATO   = 'em_contrato',
  TRANSFERIDO   = 'transferido', // era 'quitado' (vocabulário 07/09)
  RECUPERADO    = 'recuperado',
  SINISTRADO    = 'sinistrado',
}

// Rótulo único do status do ativo — estoque, ficha, alertas (Regra 9).
export const STATUS_ATIVO_LABEL: Record<StatusAtivo, string> = {
  [StatusAtivo.DISPONIVEL]: 'Disponível',
  [StatusAtivo.EM_PREPARACAO]: 'Em preparação',
  [StatusAtivo.RESERVADO]: 'Reservado',
  [StatusAtivo.EM_CONTRATO]: 'Em contrato',
  [StatusAtivo.TRANSFERIDO]: 'Transferido',
  [StatusAtivo.RECUPERADO]: 'Recuperado',
  [StatusAtivo.SINISTRADO]: 'Sinistrado',
};
export function rotuloStatusAtivo(status: string): string {
  return (STATUS_ATIVO_LABEL as Record<string, string>)[status] ?? status;
}

// Preparação do veículo (doc 02 §25.8).
export enum MotivoPreparacao {
  ENTRADA     = 'entrada',
  RECUPERACAO = 'recuperacao',
  MANUTENCAO  = 'manutencao',
}

export const MOTIVO_PREPARACAO_LABEL: Record<MotivoPreparacao, string> = {
  [MotivoPreparacao.ENTRADA]: 'Entrada no estoque',
  [MotivoPreparacao.RECUPERACAO]: 'Carro recuperado',
  [MotivoPreparacao.MANUTENCAO]: 'Manutenção',
};

export enum SituacaoItemPreparacao {
  FEITO         = 'feito',
  NAO_SE_APLICA = 'nao_se_aplica',
}

export const SITUACAO_ITEM_PREPARACAO_LABEL: Record<SituacaoItemPreparacao, string> = {
  [SituacaoItemPreparacao.FEITO]: 'Feito',
  [SituacaoItemPreparacao.NAO_SE_APLICA]: 'Não se aplica',
};

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
