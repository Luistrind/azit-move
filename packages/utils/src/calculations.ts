// ============================================================
// FÓRMULAS E CONSTANTES DE NEGÓCIO — fonte única (Regra 16 do CLAUDE.md,
// decisão Luís 2026-10-20: "uma conta, uma função").
//
// Toda conta financeira do sistema existe UMA vez, aqui, e é chamada daqui
// por backend e frontend (via @azit/utils). Proibido reescrever a conta no
// service ou na tela, mesmo "só para exibir" — o lint da raiz
// (eslint.config.mjs) derruba o CI se aparecer Math.pow / ** fora deste
// pacote. Tudo em CENTAVOS (inteiros); taxas em FRAÇÃO (0,02 = 2%).
//
// CONVENÇÃO DE TAXA (doc 02 §7.4, planilha do Vicente 11/07/2026): a taxa de
// negócio é sempre MENSAL (TR, dcr, encargo do reembolso…). Para descontar
// por dias, converte-se à DIÁRIA equivalente na base 30:
//     d = (1 + tm)^(1/30) − 1        →  VP = VF / (1 + d)^dias
// e, para a Price por período (semana/quinzena/mês), à taxa do PERÍODO:
//     i = (1 + tm)^(dias/30) − 1     (7 / 14 / 30 dias)
// A fórmula antiga de taxa DIÁRIA parametrizável (calcularValorPresente /
// calcularQuitacaoTotal, doc 04 original) foi REMOVIDA em 20/10/2026: não
// tinha chamador e contrariava a convenção validada do §7.4.
// ============================================================

// ------------------------------------------------------------
// Frequências e dias por período
// ------------------------------------------------------------
export type FrequenciaPeriodo = 'semanal' | 'quinzenal' | 'mensal';

/** Dias de cada período para a equivalência de taxa (base mensal 30). */
export const DIAS_POR_PERIODO: Record<FrequenciaPeriodo, number> = { semanal: 7, quinzenal: 14, mensal: 30 };

/** Aceita o enum do banco ('SEMANAL') ou a forma da API ('semanal'). */
export function normalizarFrequencia(f: string): FrequenciaPeriodo {
  const x = f.toLowerCase();
  if (x === 'semanal' || x === 'quinzenal' || x === 'mensal') return x;
  throw new Error(`Frequência desconhecida: ${f}`);
}

// ------------------------------------------------------------
// Fatores de PRAZO (nº de parcelas por mês) e de VALOR (parcela exibida)
// ------------------------------------------------------------
// PRAZO — reunião 04/07 + Catálogo (decisão 02/08, requisitos v0.3 pergunta 7):
// quantas parcelas cabem em um mês de prazo. O Catálogo é a verdade do
// domínio; estes são os defaults da casa que ele e todos os motores usam.
// Nunca converter meses↔parcelas por dias corridos (60×30/7 = 257 cortava um
// contrato real de 260 semanais = 60 meses). Versões antigas de parâmetros
// gravadas no banco podem carregar 4,345/2,1725 — são dado versionado, não
// constante; a constante da casa é esta.
export const FATOR_PRAZO_SEMANAL = 4.3452;
export const FATOR_PRAZO_QUINZENAL = 2.1726;

// VALOR — reunião 11/07 (Vicente) e homologação 04/08: a parcela EXIBIDA
// divide o valor mensal por 4 (semanal) e 2 (quinzenal) — números comerciais;
// e o inverso: valor semanal × 4 = mensal, × 2 = quinzenal (proteção).
export const FATOR_VALOR_SEMANAL = 4;
export const FATOR_VALOR_QUINZENAL = 2;

/** Fator de PRAZO da frequência (mensal 1; quinzenal 2,1726; semanal 4,3452). */
export function fatorPrazoPorFrequencia(f: FrequenciaPeriodo | string): number {
  const x = normalizarFrequencia(f);
  return x === 'mensal' ? 1 : x === 'quinzenal' ? FATOR_PRAZO_QUINZENAL : FATOR_PRAZO_SEMANAL;
}

/** Prazo em meses → nº de parcelas na frequência (fator de prazo padrão, arredondado). */
export function parcelasPorPrazoMeses(prazoMeses: number, frequencia: FrequenciaPeriodo | string): number {
  return Math.round(prazoMeses * fatorPrazoPorFrequencia(frequencia));
}

/** Divisor do valor MENSAL para o período (mensal 1; quinzenal 2; semanal 4). */
export function fatorValorPorFrequencia(f: FrequenciaPeriodo | string): number {
  const x = normalizarFrequencia(f);
  return x === 'mensal' ? 1 : x === 'quinzenal' ? FATOR_VALOR_QUINZENAL : FATOR_VALOR_SEMANAL;
}

/** Multiplicador do valor SEMANAL para o período (semanal 1; quinzenal 2; mensal 4). */
export function fatorValorDesdeSemanal(f: FrequenciaPeriodo | string): number {
  const x = normalizarFrequencia(f);
  return x === 'semanal' ? 1 : x === 'quinzenal' ? FATOR_VALOR_QUINZENAL : FATOR_VALOR_SEMANAL;
}

// ------------------------------------------------------------
// Equivalência de taxas (base mensal 30 dias)
// ------------------------------------------------------------
/** Taxa DIÁRIA equivalente à mensal: d = (1 + tm)^(1/30) − 1. */
export function taxaDiariaEquivalente(taxaMensal: number): number {
  return Math.pow(1 + taxaMensal, 1 / 30) - 1;
}

/** Taxa do PERÍODO de `dias` equivalente à mensal: i = (1 + tm)^(dias/30) − 1. */
export function taxaPeriodoEquivalente(taxaMensal: number, dias: number): number {
  return Math.pow(1 + taxaMensal, dias / 30) - 1;
}

// ------------------------------------------------------------
// Valor presente (doc 02 §7.4)
// ------------------------------------------------------------
/**
 * Valor presente de um valor futuro descontado por DIAS à taxa MENSAL,
 * convertida à diária equivalente: VP = VF / (1 + d)^dias.
 * Sem desconto (devolve VF) quando dias ≤ 0 ou taxa ≤ 0 — parcela vencida ou
 * de hoje não desconta (§7.4); taxa zero é "componente cheio".
 * Devolve fração de centavo: quem compõe arredonda UMA vez no fim.
 */
export function valorPresenteMensal(vf: number, taxaMensal: number, dias: number): number {
  if (dias <= 0 || taxaMensal <= 0) return vf;
  const d = taxaDiariaEquivalente(taxaMensal);
  return vf / Math.pow(1 + d, dias);
}

// ------------------------------------------------------------
// Tabela Price (sistema francês)
// ------------------------------------------------------------
/**
 * Parcela fixa (PMT) que amortiza `pv` em `n` períodos à taxa `i` por período:
 * PMT = PV × i × (1+i)^n / ((1+i)^n − 1); para i = 0, PMT = PV / n.
 * Devolve fração de centavo (o chamador decide round/ceil).
 */
export function pmtPrice(pv: number, i: number, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error('n deve ser inteiro >= 1');
  if (pv === 0) return 0;
  if (i === 0) return pv / n;
  const fator = Math.pow(1 + i, n);
  return (pv * (i * fator)) / (fator - 1);
}

// ------------------------------------------------------------
// Encargo por atraso (doc 02 §7.2)
// ------------------------------------------------------------
/**
 *   encargo = valor × (multa%) + valor × (juros% / 30) × dias_atraso
 * Taxas em pontos percentuais (multa 2 = 2%, juros 1 = 1% ao mês pro-rata die).
 * Calculado internamente para conciliação, independente do que o Asaas retornar.
 */
export function calcularEncargoAtraso(
  valor: number,
  diasAtraso: number,
  taxaMultaPercent = 2,
  taxaJurosMensalPercent = 1,
): number {
  if (diasAtraso <= 0) return 0;
  const multa = valor * (taxaMultaPercent / 100);
  const juros = valor * (taxaJurosMensalPercent / 100 / 30) * diasAtraso;
  return multa + juros;
}
