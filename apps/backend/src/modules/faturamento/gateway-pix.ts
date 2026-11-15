// GatewayPix (doc 02 §32.4-A): a ÚNICA porta entre o domínio da Fatura Azit e
// quem emite o Pix. O domínio pede "um Pix de valor X, válido hoje, com esta
// referência" e lê de volta "este Pix foi pago". Trocar o Asaas por um banco no
// padrão do Banco Central, ou acrescentar split, é trocar a implementação
// registrada em GATEWAY_PIX — nada fora do adaptador conhece o Asaas.

export const GATEWAY_PIX = Symbol('GATEWAY_PIX');

export interface PixCriado {
  gatewayId: string; // id da cobrança no gateway
  copiaECola: string;
  qrCodeImagem: string | null; // PNG em base64, quando o gateway devolve
  simulado: boolean; // ambiente sem gateway real: o código não é pagável
}

// Situação de um Pix lida no gateway (conferência, expiração).
export interface PixConsultado {
  existe: boolean; // false = o gateway não tem mais essa cobrança
  pago: boolean;
  valor: number; // centavos recebidos (0 se não pago)
  dataPagamento: string | null; // 'YYYY-MM-DD'
  pagamentoId: string | null; // id do pagamento — chave da idempotência
}

// Evento de webhook já traduzido para a língua do domínio.
export interface EventoPix {
  referencia: string; // a referência enviada na criação (`intencao:<id>`)
  pago: boolean; // true = dinheiro recebido/confirmado
  pagamentoId: string; // id do pagamento no gateway
  valor: number; // centavos
  dataPagamento: string | null; // 'YYYY-MM-DD'; null = o gateway não informou
  identificadorPix: string | null; // identificador da transação, quando vem
}

export interface GatewayPix {
  readonly nome: string;
  readonly simulado: boolean;

  // Cria um Pix de valor EXATO, com vencimento em `dia` e SEM multa nem juros
  // nativos — o encargo é da Azit (§32.4). O pagador é o titular da conta.
  criarPix(pedido: { referencia: string; valor: number; dia: string; descricao: string; titularId: string }): Promise<PixCriado>;

  // Cancela um Pix que não vale mais (intenção substituída ou expirada).
  // NUNCA apaga cobrança paga: devolve `pago: true` e quem chamou enfileira a baixa.
  cancelarPix(gatewayId: string): Promise<{ cancelado: boolean; pago: boolean }>;

  consultarPix(gatewayId: string): Promise<PixConsultado>;

  // Lê o corpo do webhook do gateway. `null` = não é evento de Pix deste fluxo.
  interpretarWebhook(corpo: unknown): EventoPix | null;
}

export const PREFIXO_INTENCAO = 'intencao:';
export const referenciaIntencao = (intencaoId: string) => `${PREFIXO_INTENCAO}${intencaoId}`;
export const intencaoDaReferencia = (referencia: string | null | undefined): string | null =>
  referencia?.startsWith(PREFIXO_INTENCAO) ? referencia.slice(PREFIXO_INTENCAO.length) : null;
