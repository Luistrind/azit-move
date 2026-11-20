import { cobrancaAsaasPaga } from './migracao-legado';

// Conferência "Asaas × sistema" das faturas em aberto (doc 02 §27.9, 12/11/2026).
// A Carteira mostrava 42 faturas vencidas em novembro e o painel do Asaas, 35:
// as 7 a mais eram cobranças já pagas lá (webhook perdido) ou alteradas/removidas
// no painel. Esta função compara UMA fatura (como está aqui) com a cobrança
// correspondente (como está no Asaas) e diz, em uma palavra, o que diverge.
// Só leitura: classificar nunca muda nada; reconciliar é ação à parte, e só
// para `paga_no_asaas`, pelo MESMO job que o webhook enfileira.
// Uma conta só (Regra 16): backend classifica, tela só exibe.

export type ClassificacaoConferenciaAsaas =
  | 'ok' // aberta nos dois lados, mesmo vencimento e valor
  | 'paga_no_asaas' // Asaas registra o recebimento; aqui segue ABERTA/FECHADA
  | 'removida_no_asaas' // cobrança apagada (404 / deleted / DELETED)
  | 'estornada_no_asaas' // estorno ou chargeback: o cliente não tem mais o que pagar nessa cobrança
  | 'vencimento_diferente' // aberta nos dois, mas o vencimento foi alterado no painel
  | 'valor_diferente'; // aberta nos dois, mas o valor foi alterado no painel

export const CLASSIFICACOES_CONFERENCIA_ASAAS: readonly ClassificacaoConferenciaAsaas[] = [
  'paga_no_asaas',
  'removida_no_asaas',
  'estornada_no_asaas',
  'vencimento_diferente',
  'valor_diferente',
  'ok',
];

// Status do Asaas em que a cobrança deixou de valer por devolução do dinheiro
// (ou disputa dele). Não é "paga" nem "em aberto": a fatura aqui continua devida,
// mas essa cobrança não serve mais — precisa de reemissão ou decisão do operador.
const ESTORNADA: ReadonlySet<string> = new Set([
  'REFUNDED',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

export function cobrancaAsaasEstornada(status: string | null | undefined): boolean {
  return !!status && ESTORNADA.has(status);
}

export interface FaturaParaConferir {
  vencimento: string; // YYYY-MM-DD (fuso do negócio)
  valor: number; // centavos — valorTotal da fatura
}

export interface CobrancaParaConferir {
  status: string;
  deleted?: boolean | null;
  dueDate: string; // YYYY-MM-DD
  value: number; // reais, como a API devolve
}

// `cobranca` nula = o Asaas respondeu 404 (não existe mais).
// Ordem: removida → estornada → paga → vencimento → valor → ok. Vencimento antes
// de valor porque é o que muda a raia (vencida/a vencer) e a régua.
export function classificarConferenciaAsaas(
  fatura: FaturaParaConferir,
  cobranca: CobrancaParaConferir | null,
): ClassificacaoConferenciaAsaas {
  if (!cobranca || cobranca.deleted || cobranca.status === 'DELETED') return 'removida_no_asaas';
  if (cobrancaAsaasEstornada(cobranca.status)) return 'estornada_no_asaas';
  if (cobrancaAsaasPaga(cobranca.status)) return 'paga_no_asaas';
  if (cobranca.dueDate !== fatura.vencimento) return 'vencimento_diferente';
  if (Math.round(cobranca.value * 100) !== fatura.valor) return 'valor_diferente';
  return 'ok';
}

// Contagem por classificação (cabeçalho da conferência; todas as chaves sempre presentes).
export function contarClassificacoes(
  linhas: readonly { classificacao: ClassificacaoConferenciaAsaas }[],
): Record<ClassificacaoConferenciaAsaas, number> {
  const base = Object.fromEntries(CLASSIFICACOES_CONFERENCIA_ASAAS.map((c) => [c, 0])) as Record<
    ClassificacaoConferenciaAsaas,
    number
  >;
  for (const l of linhas) base[l.classificacao] += 1;
  return base;
}

// ---------------------------------------------------------------------------
// Conferência AUTOMÁTICA diária (doc 02 §27.9.1, 18/11/2026 — incidente da
// v1.9.0: Pix de cobrança comum não baixava; casos Leonardo, fatura 191, e
// Pedro Jose, fatura 49). O que a rodada faz com cada linha já classificada:
//   · baixar — paga no Asaas e aberta aqui: enfileira o MESMO `conciliar` do webhook;
//   · pago_a_menor_ja_registrado — paga no Asaas, mas esse mesmo valor já foi
//     imputado aqui como pagamento parcial (§7.3): reconciliar de novo não muda
//     nada, então fica para o operador em vez de "baixar" todo dia;
//   · divergencia — qualquer outra diferença: só lista, nunca corrige sozinha;
//   · ok — bate.
export type DecisaoConferenciaAutomatica = 'baixar' | 'pago_a_menor_ja_registrado' | 'divergencia' | 'ok';

export interface LinhaParaDecidir {
  classificacao: ClassificacaoConferenciaAsaas;
  valorPagoAqui: number | null; // centavos — valorPago gravado na fatura (só existe depois de parcial)
  valorPagoAsaas: number | null; // centavos — value da cobrança lida no Asaas
}

export function decidirConferenciaAutomatica(l: LinhaParaDecidir): DecisaoConferenciaAutomatica {
  if (l.classificacao === 'ok') return 'ok';
  if (l.classificacao !== 'paga_no_asaas') return 'divergencia';
  const jaImputado = l.valorPagoAqui !== null && l.valorPagoAqui > 0 && l.valorPagoAqui === l.valorPagoAsaas;
  return jaImputado ? 'pago_a_menor_ja_registrado' : 'baixar';
}

// Divergência que NÃO estava na rodada anterior (mesma fatura, mesma
// classificação) — só ela gera aviso no sino; a repetida segue listada na tela,
// sem tocar o sino todo dia. Sem rodada anterior, todas são novas.
export function divergenciasNovas<T extends { faturaId: string; classificacao: string }>(
  atuais: readonly T[],
  anteriores: readonly { faturaId: string; classificacao: string }[] | null,
): T[] {
  if (!anteriores) return [...atuais];
  const vistas = new Set(anteriores.map((a) => `${a.faturaId}|${a.classificacao}`));
  return atuais.filter((a) => !vistas.has(`${a.faturaId}|${a.classificacao}`));
}
