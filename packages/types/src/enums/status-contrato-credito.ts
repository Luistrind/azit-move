// Status do ContratoCredito — Doc 2 §5.2 / Doc 3 §4.3.
// Não existe status "Renegociado": a renegociação vive no Acordo; o contrato volta a Ativo.
// Valores são os rótulos de exibição (statusColors.ts indexa por eles).
export enum StatusContratoCredito {
  RASCUNHO                         = 'Rascunho',
  AGUARDANDO_ASSINATURA            = 'Aguardando assinatura',
  AGUARDANDO_PAGAMENTO_INICIAL     = 'Aguardando pagamento inicial',
  AGUARDANDO_ENTREGA_VEICULO       = 'Aguardando entrega do veículo',
  ATIVO                            = 'Ativo',
  INADIMPLENTE                     = 'Inadimplente',
  BLOQUEADO                        = 'Bloqueado',
  SUSPENSO                         = 'Suspenso',
  EM_RECUPERACAO_VEICULO           = 'Em recuperação de veículo',
  CANCELADO                        = 'Cancelado',
  RESCINDIDO                       = 'Rescindido',
  QUITADO_AGUARDANDO_TRANSFERENCIA = 'Quitado (aguardando transferência)',
  QUITADO_TRANSFERENCIA_EFETIVADA  = 'Quitado (transferência efetivada)',
}
