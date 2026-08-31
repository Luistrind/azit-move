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
