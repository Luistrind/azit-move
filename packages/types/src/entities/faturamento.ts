import type { GrupoCascataFatura, OrigemIntencaoPagamento, OrigemPagamentoFatura, SituacaoIntencaoPagamento } from '../enums/faturamento';

// Parâmetros de faturamento (doc 02 §32.8) — Configurações › Faturamento.
// Versionados: salvar cria uma versão nova; vale a de maior número.
// Dinheiro em CENTAVOS; percentuais em pontos (35 = 35%).
export interface ParametrosFaturamento {
  versao: number; // 0 = padrões provisórios (nada salvo ainda)
  // Chave de virada (§32.4-A): ligada, as faturas que fecharem dali em diante
  // nascem no modelo AZIT, sem cobrança pré-criada no gateway.
  pixSobDemanda: boolean;
  multaPadraoPct: number; // FAT001
  atualizacaoMesPadraoPct: number; // FAT002
  cascata: GrupoCascataFatura[]; // FAT003
  minimoParcialPct: number; // FAT004 — % do valor de face
  minimoParcialPiso: number; // FAT004 — piso, centavos
  tetoIntencoesDia: number;
}

export interface VersaoParametrosFaturamento extends ParametrosFaturamento {
  motivo: string | null;
  criadoPor: string | null; // nome do usuário
  criadoEm: string; // ISO
}

export interface ParametrosFaturamentoResposta {
  vigente: ParametrosFaturamento;
  // Quantas faturas FECHADAS em aberto existem em cada modelo — o que a chave
  // já produziu e o que segue no modelo antigo até liquidar (§32.4-A).
  faturasEmAberto: { azit: number; asaasNativo: number };
  historico: VersaoParametrosFaturamento[];
}

// ------------------------------------------------------------
// Ficha do titular (operador) — pagamentos da fatura e intenção ativa
// ------------------------------------------------------------
export interface AlocacaoPagamentoFatura {
  nome: string; // item da fatura ou encargo, com o MESMO nome da página
  valor: number;
  nivel: number;
  quitou: boolean;
  encargo: boolean;
}

export interface PagamentoFaturaOperador {
  id: string;
  data: string; // YYYY-MM-DD
  pagoEm: string | null; // ISO, quando o gateway informou a hora
  valor: number; // aplicado a ESTA fatura
  valorExcedente: number;
  origem: OrigemPagamentoFatura;
  identificadorPix: string | null;
  intencaoId: string | null;
  alocacoes: AlocacaoPagamentoFatura[];
}

export interface IntencaoPagamentoOperador {
  id: string;
  valor: number;
  situacao: SituacaoIntencaoPagamento;
  origem: OrigemIntencaoPagamento;
  dia: string; // YYYY-MM-DD
  validoAte: string; // ISO
  criadaEm: string; // ISO
  faturas: { numero: number; vencimento: string; valor: number }[];
  outroValor: boolean;
  simulado: boolean;
}
