// ============================================================
// Datas do NEGÓCIO — fonte única de "hoje" e de dia-calendário (Regra 15 do
// CLAUDE.md, 20/10/2026). Nenhum lugar do sistema deriva dia de
// `toISOString().slice(0,10)`, de `new Date().getDate()` nem de qualquer
// aritmética UTC: o servidor roda em UTC e, das 21h às 24h de Brasília,
// "hoje" em UTC já é amanhã. Caso real (16/10): a limpeza de órfãs da
// migração usou hoje em UTC e apagou cobrança válida do dia.
//
// Duas famílias de valor, com helpers distintos:
//   • INSTANTE (timestamp real: createdAt, dataConsulta, agora) → diaBrasil().
//   • DIA-CALENDÁRIO gravado como DateTime (vencimentos, fechamento, 1ª
//     parcela): o cronograma grava meia-noite UTC e o legado/novação gravam
//     03:00Z (meia-noite de Brasília). Em ambos, o dia é o do calendário UTC →
//     dataCalendarioUTC(). NUNCA diaBrasil() aqui: meia-noite UTC ainda é o
//     dia anterior em Brasília.
// Este arquivo é o ÚNICO lugar onde toISOString()/toLocaleDateString sem
// fuso explícito são tolerados (ver eslint.config.mjs na raiz).
// ============================================================

export const FUSO_NEGOCIO = 'America/Sao_Paulo';

// Milissegundos de um dia — ÚNICA definição (Regra 16). Só para deslocar
// instantes ("−5 dias de um timestamp", janelas); contagem de dias entre datas
// é diasCalendarioEntre/diasAtrasoCalendario — dividir ms por 24h zera o
// primeiro dia quando há hora (correção 31/08).
export const DIA_MS = 86_400_000;

// 'YYYY-MM-DD' de um INSTANTE no fuso do negócio.
export function diaBrasil(instante: Date): string {
  return instante.toLocaleDateString('en-CA', { timeZone: FUSO_NEGOCIO });
}

// 'YYYY-MM-DD' de hoje no fuso America/Sao_Paulo.
export function dataHojeBrasil(): string {
  return diaBrasil(new Date());
}

// Dia, hora e dia da semana (0 = domingo) de um instante no fuso do negócio —
// para regras de "corte às 12h", "dia útil", "janela 9–17h".
export function partesBrasil(instante: Date): { dia: string; hora: number; minuto: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_NEGOCIO,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(instante);
  const v = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday'));
  return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')), minuto: Number(v('minute')), diaSemana: semana };
}

// Meia-noite UTC de um dia-calendário 'YYYY-MM-DD' — a forma como o cronograma
// grava vencimentos/fechamentos.
export function inicioDiaUTC(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

// Meia-noite UTC do dia de hoje no Brasil — comparável diretamente com as
// datas de vencimento armazenadas (UTC-midnight da data-calendário).
export function inicioHojeBrasilUTC(): Date {
  return inicioDiaUTC(dataHojeBrasil());
}

// Data-calendário ('YYYY-MM-DD') de uma coluna de DATA do banco (gravada em
// UTC-midnight ou 03:00Z). Para timestamps reais use diaBrasil().
export function dataCalendarioUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Coluna MISTA: ora recebe um dia escolhido na tela (z.coerce.date de
// 'YYYY-MM-DD' → meia-noite UTC), ora `now()` (instante). Ex.: lançamento do
// centro de custo, vigência de oferta. Meia-noite UTC exata é lida como
// dia-calendário; qualquer outro horário, como instante no fuso do negócio.
// Heurística documentada (Regra 12) — a solução definitiva é a coluna gravar
// sempre dia-calendário.
export function diaDeColunaMista(d: Date): string {
  const meiaNoiteUTC = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return meiaNoiteUTC ? dataCalendarioUTC(d) : diaBrasil(d);
}

// Soma N dias de CALENDÁRIO a um 'YYYY-MM-DD' (aritmética no calendário UTC,
// sem horário de verão nem fuso).
export function somarDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Dia da semana (0 = domingo … 6 = sábado) de um 'YYYY-MM-DD'.
export function diaSemanaISO(iso: string): number {
  return inicioDiaUTC(iso).getUTCDay();
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY'.
export function isoParaBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// 'DD/MM/YYYY' de uma coluna de DATA do banco (vencimento, 1ª parcela).
export function formatarDiaBR(d: Date): string {
  return isoParaBR(dataCalendarioUTC(d));
}

// 'DD/MM/YYYY' de um INSTANTE (createdAt, assinouEm) no fuso do negócio.
export function formatarInstanteBR(instante: Date): string {
  return isoParaBR(diaBrasil(instante));
}

// Diferença em DIAS DE CALENDÁRIO entre duas datas 'YYYY-MM-DD' (b − a).
export function diasCalendarioEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number);
  const [by, bm, bd] = bISO.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DIA_MS);
}

// Soma N dias ÚTEIS (seg–sex) a uma data (A5, 04/09): antes os prazos "em dias
// úteis" da análise eram somados como corridos ou aproximados por ×1,4 num
// gate de crédito. Feriados nacionais NÃO são considerados (placeholder
// funcional — Regra 12; calendário de feriados é parametrização futura).
export function adicionarDiasUteis(inicio: Date, diasUteis: number): Date {
  const d = new Date(inicio.getTime());
  let restantes = Math.max(0, Math.round(diasUteis));
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) restantes -= 1;
  }
  return d;
}

// Dias de atraso de um vencimento, em dias de CALENDÁRIO (correção 31/08):
// dividir a diferença de milissegundos por 24h zera o primeiro dia quando o
// vencimento carrega hora (ex.: venc ontem 14:02 → "0,4 dia" → 0) — caso real:
// contrato com fatura vencida ONTEM sumia da régua. Referência default: hoje
// no fuso do negócio; passar a data de pagamento para conciliar atrasos.
export function diasAtrasoCalendario(vencimento: Date, referencia?: Date): number {
  const ref = referencia ? dataCalendarioUTC(referencia) : dataHojeBrasil();
  return Math.max(0, diasCalendarioEntre(dataCalendarioUTC(vencimento), ref));
}
