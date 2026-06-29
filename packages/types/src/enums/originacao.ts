// Enums da camada de originação (funil que antecede o ContratoCredito) — Doc 2 §4-A / Doc 5 §3.
// Modelos e telas são do Bloco 7; estes enums entram no schema desde já.

export enum CanalOrigem {
  OPERADOR_INTERNO = 'operador_interno',
  LANDING_PAGE     = 'landing_page',
  OUTRO            = 'outro',
}

export enum StatusProposta {
  PENDENTE        = 'pendente',
  EM_ANALISE      = 'em_analise',
  APROVADA        = 'aprovada',
  REPROVADA       = 'reprovada',
  CANCELADA       = 'cancelada',
  EM_FORMALIZACAO = 'em_formalizacao',
  CONVERTIDA      = 'convertida',
}

export enum ModalidadeContrato {
  ASSINATURA       = 'assinatura',
  COMPRA_PARCELADA = 'compra_parcelada',
  COMPRA_VISTA     = 'compra_vista',
}

export enum PapelTitular {
  COMPRADOR_PRINCIPAL  = 'comprador_principal',
  COMPRADOR_SECUNDARIO = 'comprador_secundario',
  GARANTIDOR           = 'garantidor',
}

export enum TipoDocumentoProposta {
  CNH                  = 'cnh',
  COMPROVANTE_ENDERECO = 'comprovante_endereco',
  COMPROVANTE_RENDA    = 'comprovante_renda',
  RELATORIO_BRICK      = 'relatorio_brick',
  OUTRO                = 'outro',
}

export enum ResultadoParecer {
  APROVADO              = 'aprovado',
  APROVADO_COM_RESSALVAS = 'aprovado_com_ressalvas',
  REPROVADO             = 'reprovado',
}

export enum OrigemCalculoOferta {
  PACOTE_GENERICO   = 'pacote_generico',
  VALOR_VENDA_ATIVO = 'valor_venda_ativo',
}
