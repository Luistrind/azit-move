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
}

export interface SituacaoFaturaPublicaResumo {
  situacao: SituacaoFaturaPublica;
  pagaParcialmente: boolean;
  valorPago: number;
  totalHoje: number;
  dataPagamento: string | null;
}
