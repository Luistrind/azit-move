// GatewayPix (doc 02 §32.4-A): a ÚNICA porta entre o domínio da Fatura Azit e
// quem emite o Pix. O domínio pede "um Pix de valor X, válido hoje, com esta
// referência" e lê de volta "este Pix foi pago". Trocar o Asaas por um banco no
// padrão do Banco Central, ou acrescentar split, é trocar a implementação
// registrada em GATEWAY_PIX — nada fora do adaptador conhece o Asaas.

export const GATEWAY_PIX = Symbol('GATEWAY_PIX');

export interface PixCriado {
  gatewayId: string; // id do Pix no gateway (QR estático ou cobrança, conforme o modo)
  copiaECola: string;
  qrCodeImagem: string | null; // PNG em base64, quando o gateway devolve
  simulado: boolean; // ambiente sem gateway real: o código não é pagável
}

// Situação de um Pix lida no gateway (conferência, expiração).
export interface PixConsultado {
  existe: boolean; // false = o gateway não tem mais esse Pix
  pago: boolean;
  valor: number; // centavos recebidos (0 se não pago)
  dataPagamento: string | null; // 'YYYY-MM-DD'
  pagamentoId: string | null; // id do pagamento — chave da idempotência
}

// Evento de webhook já traduzido para a língua do domínio. O gateway diz de
// qual Pix veio o dinheiro por um de dois caminhos: a REFERÊNCIA enviada na
// criação (`intencao:<id>`) ou o ID DO PIX (`gatewayId` da intenção). Quando o
// aviso não traz nenhum dos dois, o worker pergunta ao gateway (`pixDoPagamento`).
export interface EventoPix {
  referencia: string | null; // `intencao:<id>`, quando o gateway devolve a referência
  gatewayId: string | null; // id do Pix que originou o pagamento, quando o aviso traz
  pago: boolean; // true = dinheiro recebido/confirmado
  pagamentoId: string; // id do pagamento no gateway
  valor: number; // centavos
  dataPagamento: string | null; // 'YYYY-MM-DD'; null = o gateway não informou
  identificadorPix: string | null; // identificador da transação, quando vem
}

// Quem recebe o Pix (a chave Pix da conta da Azit no gateway) — para a tela de
// Configurações › Faturamento dizer se dá para gerar Pix e, se não, por quê.
export interface ChaveRecebimentoPix {
  simulado: boolean;
  disponivel: boolean;
  chaveMascarada: string | null;
  tipoChave: string | null;
  motivo: string | null;
}

export interface PedidoPix {
  referencia: string;
  valor: number; // centavos
  dia: string; // 'YYYY-MM-DD' (Brasil) — o Pix vale até 23h59 desse dia
  descricao: string;
  // Texto curto e sem acento para o extrato do pagador (o QR tem pouco espaço).
  descricaoCurta: string;
  titularId: string;
}

export interface GatewayPix {
  readonly nome: string;
  readonly simulado: boolean;

  // Cria um Pix de valor EXATO, válido em `dia` e SEM multa nem juros nativos —
  // o encargo é da Azit (§32.4).
  criarPix(pedido: PedidoPix): Promise<PixCriado>;

  // Cancela um Pix que não vale mais (intenção substituída ou expirada).
  // NUNCA apaga Pix pago: devolve `pago: true` e quem chamou enfileira a baixa.
  cancelarPix(gatewayId: string): Promise<{ cancelado: boolean; pago: boolean }>;

  consultarPix(gatewayId: string): Promise<PixConsultado>;

  // Lê o corpo do webhook do gateway. `null` = não é pagamento Pix que possa
  // ser deste fluxo (tem dono em outro fluxo, ou não é Pix).
  interpretarWebhook(corpo: unknown): EventoPix | null;

  // De qual Pix (gatewayId) veio um pagamento, quando o aviso não disse.
  // `null` = o pagamento não veio de um Pix deste fluxo.
  pixDoPagamento(pagamentoId: string): Promise<string | null>;

  chaveRecebimento(): Promise<ChaveRecebimentoPix>;
}

export const PREFIXO_INTENCAO = 'intencao:';
export const referenciaIntencao = (intencaoId: string) => `${PREFIXO_INTENCAO}${intencaoId}`;
export const intencaoDaReferencia = (referencia: string | null | undefined): string | null =>
  referencia?.startsWith(PREFIXO_INTENCAO) ? referencia.slice(PREFIXO_INTENCAO.length) : null;
