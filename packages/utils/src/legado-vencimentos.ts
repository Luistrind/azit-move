// Migração do legado — VENCIMENTOS do cronograma migrado (doc 02 §26.15 item 5,
// decisão Luís 20/10/2026, casos Carmo 2026030001 e Gerci 2026090017).
//
// Parcela, fatura e recebível são o MESMO compromisso e vencem no MESMO dia.
// Na migração esse dia é o da COBRANÇA REAL do Asaas (o cliente paga sexta,
// não a segunda do papel); a parcela sem cobrança própria (futura, adiada,
// coberta por acordo sem cobrança) continua a CADÊNCIA a partir da última
// data real — semanal +7, quinzenal +14, mensal mesmo dia do mês — pelo mesmo
// passo do cronograma nativo (`avancarVencimento`, Regra 16). A data do papel
// fica registrada ao lado (`contrato`) só para a prévia e a auditoria.
//
// Antes (modo "vencimentos CONTRATO", §26.9 item 4): a parcela nascia na data
// do papel e a fatura na da cobrança; ficha, régua e D+3 liam a parcela e o
// contrato aparecia "em atraso" com a fatura em dia. O modo deixou de existir.

import { avancarVencimento, type PeriodicidadeCronograma } from './cronograma';
import { dataCalendarioUTC, inicioDiaUTC } from './datas';

export type OrigemVencimentoLegado = 'cobranca' | 'cadencia' | 'contrato';

export interface LinhaVencimentoLegado {
  chave: string;
  esperadoEm: string; // 'YYYY-MM-DD' — data do contrato (papel)
  cobradoEm: string | null; // 'YYYY-MM-DD' — data da cobrança PRÓPRIA da parcela no Asaas (null = sem cobrança)
}

export interface VencimentoLegado {
  chave: string;
  contrato: string; // data do papel
  efetivo: string; // dia em que parcela, fatura e recebível vencem
  origem: OrigemVencimentoLegado; // de onde veio a data efetiva
  diverge: boolean; // efetivo ≠ contrato
}

// Avança N períodos a partir de um 'YYYY-MM-DD' (semanal +7n, quinzenal +14n,
// mensal por mês do calendário com clamp no fim do mês) — o passo do cronograma.
export function avancarPeriodoISO(iso: string, n: number, periodicidade: PeriodicidadeCronograma): string {
  return dataCalendarioUTC(avancarVencimento(inicioDiaUTC(iso), n, periodicidade));
}

// Alinha os vencimentos das parcelas (na ordem em que entram no cronograma —
// adiadas por último) às cobranças reais:
//   • com cobrança própria → a data da cobrança;
//   • sem cobrança, depois de alguma data real → a cadência a partir dela
//     (âncora + k períodos, para o mensal manter o dia do mês mesmo após um
//     fevereiro curto);
//   • sem cobrança e sem data real antes → a data do contrato.
export function alinharVencimentosLegado(linhas: LinhaVencimentoLegado[], periodicidade: PeriodicidadeCronograma): VencimentoLegado[] {
  let ancora: { data: string; passos: number } | null = null;
  return linhas.map((l) => {
    let efetivo: string;
    let origem: OrigemVencimentoLegado;
    if (l.cobradoEm) {
      efetivo = l.cobradoEm;
      origem = 'cobranca';
      ancora = { data: efetivo, passos: 0 };
    } else if (ancora) {
      ancora.passos += 1;
      efetivo = avancarPeriodoISO(ancora.data, ancora.passos, periodicidade);
      origem = 'cadencia';
    } else {
      efetivo = l.esperadoEm;
      origem = 'contrato';
      ancora = { data: efetivo, passos: 0 };
    }
    return { chave: l.chave, contrato: l.esperadoEm, efetivo, origem, diverge: efetivo !== l.esperadoEm };
  });
}
