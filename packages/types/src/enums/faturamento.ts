// Fatura Azit F2 (doc 02 §32.4-A, §32.5, §32.9). Valores = os que a API envia
// (enums do Prisma em MAIÚSCULAS). Fonte única de status (Regra 9).

// Quem aplica o encargo de atraso da fatura (§32.4).
export enum ModeloEncargoFatura {
  ASAAS_NATIVO = 'ASAAS_NATIVO', // cobrança pré-criada com multa/juros do Asaas (até a F1)
  AZIT = 'AZIT', // a Azit calcula; o Pix nasce sob demanda (F2)
}

// De onde veio a baixa de um pagamento (§32.5).
export enum OrigemPagamentoFatura {
  GATEWAY = 'GATEWAY',
  CONFERENCIA = 'CONFERENCIA',
  SINISTRO = 'SINISTRO', // indenização do sinistro quitou a parcela (baixa interna, sem Pix)
}

// Encargo calculado pela Azit que uma alocação quitou (§32.4).
export enum TipoEncargoFatura {
  MULTA = 'MULTA',
  ATUALIZACAO = 'ATUALIZACAO',
}

// Nomes que o cliente e o operador leem (vocabulário 24/10: sem "juros"/"taxa").
export const ROTULO_ENCARGO_FATURA: Record<TipoEncargoFatura, string> = {
  [TipoEncargoFatura.MULTA]: 'Multa por atraso',
  [TipoEncargoFatura.ATUALIZACAO]: 'Atualização por dias de atraso',
};

// Como o Pix sob demanda nasce no gateway (§32.4-A, decisão 15/11).
export enum ModoPixSobDemanda {
  ESTATICO = 'ESTATICO', // QR estático com valor: uma chamada, sem cobrança nem cliente no gateway (padrão)
  COBRANCA = 'COBRANCA', // cobrança Pix + consulta do código (modo anterior, opção de volta)
}

export const ROTULO_MODO_PIX: Record<ModoPixSobDemanda, string> = {
  [ModoPixSobDemanda.ESTATICO]: 'QR estático com valor',
  [ModoPixSobDemanda.COBRANCA]: 'Cobrança Pix',
};

// Intenção de pagamento (§32.4-A).
export enum OrigemIntencaoPagamento {
  PAGINA_PUBLICA = 'PAGINA_PUBLICA',
  OPERADOR = 'OPERADOR',
}

export enum SituacaoIntencaoPagamento {
  ATIVA = 'ATIVA',
  PAGA = 'PAGA',
  EXPIRADA = 'EXPIRADA',
  SUBSTITUIDA = 'SUBSTITUIDA',
}

export const ROTULO_SITUACAO_INTENCAO: Record<SituacaoIntencaoPagamento, string> = {
  [SituacaoIntencaoPagamento.ATIVA]: 'Pix ativo',
  [SituacaoIntencaoPagamento.PAGA]: 'Pago',
  [SituacaoIntencaoPagamento.EXPIRADA]: 'Expirado',
  [SituacaoIntencaoPagamento.SUBSTITUIDA]: 'Cancelado após outro pagamento',
};
