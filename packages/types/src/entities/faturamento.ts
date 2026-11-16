import type { ModoPixSobDemanda, OrigemIntencaoPagamento, OrigemPagamentoFatura, SituacaoIntencaoPagamento } from '../enums/faturamento';
import type { GrupoCascata } from './fatura-motor';

// Parâmetros de faturamento (doc 02 §32.8) — Configurações › Faturamento.
// Versionados: salvar cria uma versão nova; vale a de maior número.
// Dinheiro em CENTAVOS; percentuais em pontos (35 = 35%).
export interface ParametrosFaturamento {
  versao: number; // 0 = padrões provisórios (nada salvo ainda)
  // Chave de virada (§32.4-A): ligada, as faturas que fecharem dali em diante
  // nascem no modelo AZIT, sem cobrança pré-criada no gateway.
  pixSobDemanda: boolean;
  // Como o Pix nasce no gateway (§32.4-A): QR estático com valor (padrão) ou cobrança Pix.
  modoPix: ModoPixSobDemanda;
  multaPadraoPct: number; // FAT001
  atualizacaoMesPadraoPct: number; // FAT002
  cascata: GrupoCascata[]; // FAT003
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
  // Quem recebe o Pix do QR estático: a chave Pix ativa da conta no gateway.
  recebimentoPix: RecebimentoPix;
  historico: VersaoParametrosFaturamento[];
}

// Situação da chave Pix que recebe o QR estático (§32.4-A). Sem chave ativa
// não há Pix no modo ESTATICO — a tela mostra o motivo.
export interface RecebimentoPix {
  simulado: boolean; // ambiente sem gateway real: o Pix gerado não é pagável
  disponivel: boolean;
  chaveMascarada: string | null;
  tipoChave: string | null; // CPF | CNPJ | EMAIL | PHONE | EVP
  motivo: string | null; // por que não há chave (ou por que não deu para consultar)
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
  // O Pix inteiro e onde o resto dele foi parar (baixa pela conta, §32.5): um
  // Pix de R$ 900 pode quitar esta fatura e seguir para a próxima.
  valorPix: number;
  outrasFaturas: { numero: number; valor: number }[];
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
