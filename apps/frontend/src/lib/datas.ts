// Datas do lado do operador (A3/A6, 04/09). Duas armadilhas recorrentes:
// (1) `new Date('YYYY-MM-DD')` parseia como UTC e "volta" um dia no fuso local;
// (2) `new Date().toISOString().slice(0,10)` devolve a data UTC — depois das
// 21h (UTC-3) já é amanhã. Aqui tudo é data-calendário LOCAL do operador.

// 'YYYY-MM-DD' de hoje no relógio local.
export function hojeLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' local somando N dias de calendário.
export function somarDiasISO(dias: number, base?: string): string {
  const [y, m, dd] = (base ?? hojeLocalISO()).split('-').map(Number);
  const d = new Date(y, m - 1, dd + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' local da próxima segunda-feira (padrão do vencimento p/ motoristas).
export function proximaSegundaISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Dias de atraso de um vencimento ISO em relação a hoje, por CALENDÁRIO local.
export function diasAtrasoLocal(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const venc = new Date(y, m - 1, d).getTime();
  const [hy, hm, hd] = hojeLocalISO().split('-').map(Number);
  const hoje = new Date(hy, hm - 1, hd).getTime();
  return Math.max(0, Math.round((hoje - venc) / 86400000));
}
