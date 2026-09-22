// Migração do legado (doc 02 §26) — triagem PURA de um cliente do Asaas.
//
// Recebe o que o Asaas devolve para um cliente (assinaturas e cobranças, já
// reduzidas ao essencial) e responde: em que situação ele está, quantas
// cobranças tem em cada estado, qual parece ser a parcela padrão e em que
// ordem o caso deve ser tratado. Nada aqui grava ou consulta rede.
//
// Triagem (estratégia do Luís, 21/09): primeiro os ativos SEM cobrança
// vencida — fáceis de conciliar e de achar no PopHub —; os complicados por
// último. Quem não tem assinatura ativa nem cobrança em aberto provavelmente
// não é cliente ativo e vai para o fim, como sugestão de descarte.

export type StatusCobrancaAsaas =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'DELETED'
  | string;

export interface CobrancaLegadaResumo {
  valor: number; // centavos
  vencimento: string; // YYYY-MM-DD
  status: StatusCobrancaAsaas;
  pagoEm?: string | null; // YYYY-MM-DD
  deletada?: boolean;
}

export interface AssinaturaLegadaResumo {
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | string;
  valor: number; // centavos
  ciclo: string; // WEEKLY, BIWEEKLY, MONTHLY…
}

export type SituacaoCasoLegado = 'SEM_VENCIDA' | 'COM_VENCIDA' | 'SEM_MOVIMENTO';

export interface TriagemCasoLegado {
  situacao: SituacaoCasoLegado;
  // 1 = tratar primeiro. Empate dentro da situação é desfeito por menos vencidas.
  prioridade: number;
  totalCobrancas: number;
  cobrancasPagas: number;
  cobrancasPendentes: number; // em aberto, ainda não vencidas
  cobrancasVencidas: number;
  cobrancasOutras: number; // estornadas, apagadas, em disputa…
  assinaturaAtiva: boolean;
  valorParcelaPadrao: number | null; // centavos — o valor mais frequente
  modeloSugerido: 'HB20' | 'MOBI_KWID' | null;
  primeiraCobrancaEm: string | null;
  ultimaCobrancaEm: string | null;
}

// Parcelas padrão do legado (doc 02 §26.2), em centavos.
export const PARCELA_LEGADA_HB20 = 99_700;
export const PARCELA_LEGADA_MOBI_KWID = 69_700;
export const SEGURO_LEGADO = 5_000;
export const TAXA_MENSAGENS_LEGADA = 500;

const PAGA: ReadonlySet<string> = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const EM_ABERTO: ReadonlySet<string> = new Set(['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS', 'DUNNING_REQUESTED']);

export function classificarCobrancaLegada(
  c: CobrancaLegadaResumo,
  hoje: string,
): 'paga' | 'pendente' | 'vencida' | 'outra' {
  if (c.deletada || c.status === 'DELETED') return 'outra';
  if (PAGA.has(c.status)) return 'paga';
  if (EM_ABERTO.has(c.status)) {
    // O status OVERDUE do Asaas depende do relógio deles; a data manda.
    return c.vencimento < hoje ? 'vencida' : 'pendente';
  }
  return 'outra';
}

export function triarCasoLegado(params: {
  assinaturas: AssinaturaLegadaResumo[];
  cobrancas: CobrancaLegadaResumo[];
  hoje: string; // YYYY-MM-DD
}): TriagemCasoLegado {
  const { assinaturas, cobrancas, hoje } = params;
  let pagas = 0;
  let pendentes = 0;
  let vencidas = 0;
  let outras = 0;
  const frequencia = new Map<number, number>();
  let primeira: string | null = null;
  let ultima: string | null = null;

  for (const c of cobrancas) {
    const classe = classificarCobrancaLegada(c, hoje);
    if (classe === 'paga') pagas += 1;
    else if (classe === 'pendente') pendentes += 1;
    else if (classe === 'vencida') vencidas += 1;
    else outras += 1;
    if (classe !== 'outra') {
      frequencia.set(c.valor, (frequencia.get(c.valor) ?? 0) + 1);
      if (!primeira || c.vencimento < primeira) primeira = c.vencimento;
      if (!ultima || c.vencimento > ultima) ultima = c.vencimento;
    }
  }

  const assinaturaAtiva = assinaturas.some((a) => a.status === 'ACTIVE');

  // Valor mais frequente; empate vai para o maior (a parcela cheia costuma
  // repetir mais que a entrada ou um acordo pontual).
  let valorParcelaPadrao: number | null = null;
  let melhor = 0;
  for (const [valor, n] of frequencia) {
    if (n > melhor || (n === melhor && valorParcelaPadrao !== null && valor > valorParcelaPadrao)) {
      melhor = n;
      valorParcelaPadrao = valor;
    }
  }
  if (valorParcelaPadrao === null && assinaturaAtiva) {
    valorParcelaPadrao = assinaturas.find((a) => a.status === 'ACTIVE')?.valor ?? null;
  }

  const modeloSugerido =
    valorParcelaPadrao === PARCELA_LEGADA_HB20
      ? 'HB20'
      : valorParcelaPadrao === PARCELA_LEGADA_MOBI_KWID
        ? 'MOBI_KWID'
        : null;

  let situacao: SituacaoCasoLegado;
  if (!assinaturaAtiva && pendentes === 0 && vencidas === 0) situacao = 'SEM_MOVIMENTO';
  else if (vencidas > 0) situacao = 'COM_VENCIDA';
  else situacao = 'SEM_VENCIDA';

  const base = situacao === 'SEM_VENCIDA' ? 1 : situacao === 'COM_VENCIDA' ? 2 : 3;

  return {
    situacao,
    prioridade: base,
    totalCobrancas: cobrancas.length,
    cobrancasPagas: pagas,
    cobrancasPendentes: pendentes,
    cobrancasVencidas: vencidas,
    cobrancasOutras: outras,
    assinaturaAtiva,
    valorParcelaPadrao,
    modeloSugerido,
    primeiraCobrancaEm: primeira,
    ultimaCobrancaEm: ultima,
  };
}

// Decomposição da parcela legada (doc 02 §26.2): dentro da parcela vão R$ 50
// de seguro e R$ 5 de repasse da taxa de mensagens; o resto é o parcelamento.
// Fora do padrão (997/697) a decomposição é só uma PROPOSTA — o operador
// confirma no caso. Valor pequeno demais para conter os dois itens não é
// decomposto.
export function decomporParcelaLegada(valor: number): {
  parcelamento: number;
  seguro: number;
  taxaMensagens: number;
  padrao: boolean;
} {
  const padrao = valor === PARCELA_LEGADA_HB20 || valor === PARCELA_LEGADA_MOBI_KWID;
  if (valor <= SEGURO_LEGADO + TAXA_MENSAGENS_LEGADA) {
    return { parcelamento: valor, seguro: 0, taxaMensagens: 0, padrao: false };
  }
  return {
    parcelamento: valor - SEGURO_LEGADO - TAXA_MENSAGENS_LEGADA,
    seguro: SEGURO_LEGADO,
    taxaMensagens: TAXA_MENSAGENS_LEGADA,
    padrao,
  };
}
