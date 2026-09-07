// FASE do ContratoCredito — Doc 2 §5.2 (decisão 2026-09-07, três camadas):
// o enum é só a fase de vida. Inadimplência é SITUAÇÃO calculada (em dia /
// em atraso / em acordo); bloqueio e recuperação são INTERVENÇÕES paralelas
// (carimbos). Encerrado sempre carrega o motivo (Quitação/Novação/Rescisão/
// Cancelamento). Valores são os rótulos de exibição (statusColors indexa por eles).
export enum StatusContratoCredito {
  RASCUNHO                     = 'Rascunho',
  AGUARDANDO_ASSINATURA        = 'Aguardando assinatura',
  AGUARDANDO_PAGAMENTO_INICIAL = 'Aguardando pagamento inicial',
  AGUARDANDO_ENTREGA_VEICULO   = 'Aguardando entrega do veículo',
  ATIVO                        = 'Ativo',
  ENCERRADO                    = 'Encerrado',
}

// Situação financeira do contrato — CALCULADA em runtime (Regra 7), nunca gravada.
export enum SituacaoFinanceiraContrato {
  EM_DIA    = 'Em dia',
  EM_ATRASO = 'Em atraso',
  EM_ACORDO = 'Em acordo',
}

