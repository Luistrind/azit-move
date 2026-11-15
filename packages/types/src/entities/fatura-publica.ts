import type { FaturaMotor, ParametrosMotorFatura } from './fatura-motor';

// Fatura Azit — projeção PÚBLICA da fatura (doc 02 §32.2), o contrato entre o
// backend (GET /publico/faturas/:token) e o mini-app fatura.azitmove.com.br.
// Só o que a página mostra: nada de endereço, telefone, e-mail ou CPF completo
// (decisão Luís 2026-11-11). Valores em CENTAVOS; datas-calendário em YYYY-MM-DD.

export type SituacaoFaturaPublica = 'em_aberto' | 'vence_hoje' | 'vencida' | 'paga' | 'indisponivel';

export interface ItemFaturaPublica {
  titulo: string; // "Compra Parcelada — Hyundai HB20S"
  subtitulo: string | null; // "Parcela 23 de 104"
  produto: string; // chave do produto (chaveProdutoItemFatura): compra_parcelada, protecao_veicular, ...
  valor: number;
}

export interface EncargoFaturaPublica {
  multa: number; // "Multa por atraso" (cobrada uma única vez)
  atualizacao: number; // "Atualização por dias de atraso"
  diasAtraso: number;
  // 'cobranca' = o total veio da cobrança no gateway (modelo ASAAS_NATIVO, F1);
  // 'calculo' = calculado pela Azit (doc 02 §7.2 / §32.4).
  fonte: 'cobranca' | 'calculo';
}

export interface PagamentoFaturaPublica {
  data: string; // YYYY-MM-DD
  valor: number;
}

export interface PixFaturaPublica {
  payload: string; // copia-e-cola (o QR é desenhado a partir dele)
  valor: number; // o que o PIX cobra hoje
  expiraEm: string | null;
  simulado: boolean; // ambiente sem Asaas real
}

export interface FaturaPublica {
  numero: number;
  situacao: SituacaoFaturaPublica;
  pagaParcialmente: boolean;
  titular: { primeiroNome: string; documentoMascarado: string };
  veiculo: { descricao: string; placa: string | null } | null;
  contratos: string[]; // números dos contratos envolvidos
  vencimento: string; // YYYY-MM-DD
  dataPagamento: string | null;
  itens: ItemFaturaPublica[];
  encargo: EncargoFaturaPublica | null;
  valorNominal: number; // soma dos itens (valorTotal da fatura)
  valorPago: number;
  saldoNominal: number; // valorNominal − valorPago
  totalHoje: number; // saldo + encargo (ou o que a cobrança cobra)
  pagamentos: PagamentoFaturaPublica[];
  pix: PixFaturaPublica | null;
  atendimentoWhatsapp: string | null; // WhatsApp da Azit para dúvidas (formatado)
  geradoEm: string; // ISO (instante do render; a página mostra "atualizado às")
  // Fatura Azit F2: preenchida quando a fatura é do modelo AZIT (Pix sob demanda).
  conta?: ContaFaturaPublica | null;
}

export interface SituacaoFaturaPublicaResumo {
  situacao: SituacaoFaturaPublica;
  pagaParcialmente: boolean;
  valorPago: number;
  totalHoje: number;
  dataPagamento: string | null;
  // Fatura Azit F2 (modelo AZIT): muda quando entra um pagamento em QUALQUER
  // fatura da conta ou quando o Pix ativo muda — a página recarrega.
  assinatura?: string;
}

// ------------------------------------------------------------
// Fatura Azit F2 — conta do modelo AZIT (doc 02 §32.4-A, §32.6-A).
// Quando a fatura do link é do modelo AZIT, `FaturaPublica.conta` vem
// preenchida: a página mostra as faturas em aberto da conta (da mais antiga
// para a mais nova) e refaz a conta de hoje com o motor de `@azit/utils`
// sobre `motor` — a MESMA função que o servidor usa para validar o Pix.
// Nada aqui expõe o link (token) de outra fatura.
// ------------------------------------------------------------

// Um Pix recebido, aplicado a UMA fatura (mesma ordem de `motor.faturas[i].pagamentos`).
export interface RecebidoFaturaPublica {
  data: string; // YYYY-MM-DD
  hora: string | null; // 'HH:MM' (Brasil), quando o gateway informou
  valor: number;
  identificador: string | null; // identificador da transação Pix
}

export interface FaturaContaPublica {
  id: string; // casa com motor.faturas[].id
  numero: number;
  vencimento: string; // YYYY-MM-DD
  contratos: string[];
  // Nome de cada item (o MESMO da lista, do detalhe do pagamento e do PDF).
  itens: { id: string; titulo: string; subtitulo: string | null; produto: string }[];
  recebidos: RecebidoFaturaPublica[];
}

// Pix ativo de hoje da conta (intenção de pagamento, §32.4-A).
export interface PixSobDemandaPublico {
  valor: number;
  copiaECola: string;
  qrCodeImagem: string | null; // PNG em base64, quando o gateway devolve
  validoAte: string; // ISO — 23h59 de hoje (Brasil)
  simulado: boolean; // ambiente sem gateway real: o código não é pagável
  outroValor: boolean;
  faturas: { numero: number; vencimento: string; valor: number }[];
}

export interface ContaFaturaPublica {
  hoje: string; // dia do Brasil no servidor — o "hoje" da conta
  faturaDoLink: string; // id da fatura deste link
  faturas: FaturaContaPublica[]; // em aberto + pagas recentes, da mais antiga para a mais nova
  motor: { faturas: FaturaMotor[]; parametros: ParametrosMotorFatura };
  // Conta MISTA (regra provisória §32.4-A): há fatura do modelo antigo em
  // aberto, paga pela cobrança própria dela. Aqui só a fatura AZIT mais
  // antiga pode ser paga, sozinha — sem "várias" e sem "outro valor".
  mista: boolean;
  antigasEmAberto: { numero: number; vencimento: string; valor: number }[];
  pix: PixSobDemandaPublico | null;
  recebedor: { nome: string; cnpj: string };
  atendimentoWhatsappLink: string | null; // dígitos com DDI, para o wa.me
  proximoVencimento: string | null; // próxima fatura ainda não disponível
  // Muda quando entra pagamento na conta, o dia vira ou o Pix ativo muda — a
  // página compara com a do polling (/situacao) e recarrega.
  assinatura: string;
}
