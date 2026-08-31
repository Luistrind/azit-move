// ============================================================
// Datas do NEGÓCIO (correção 30/08): vencimentos são gravados como meia-noite
// UTC representando a data-calendário; o "hoje" precisa ser a data no fuso do
// negócio (America/Sao_Paulo). Comparar com meia-noite LOCAL do servidor (ou
// com a data UTC crua) desloca o dia nas bordas — caso real: fatura vencendo
// HOJE exibida como "Vencida".
// ============================================================

// 'YYYY-MM-DD' de hoje no fuso America/Sao_Paulo.
export function dataHojeBrasil(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Meia-noite UTC do dia de hoje no Brasil — comparável diretamente com as
// datas de vencimento armazenadas (UTC-midnight da data-calendário).
export function inicioHojeBrasilUTC(): Date {
  return new Date(`${dataHojeBrasil()}T00:00:00.000Z`);
}

// Data-calendário ('YYYY-MM-DD') de uma data armazenada em UTC-midnight.
export function dataCalendarioUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Diferença em DIAS DE CALENDÁRIO entre duas datas 'YYYY-MM-DD' (b − a).
export function diasCalendarioEntre(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number);
  const [by, bm, bd] = bISO.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
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
