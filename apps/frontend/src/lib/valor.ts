// Parser de valor monetário digitado pelo operador (formato BR) → CENTAVOS.
// Convenção brasileira: '.' é separador de milhar, ',' é decimal.
//   "85.170"    -> 8517000  (R$ 85.170,00)
//   "85.170,50" -> 8517050
//   "85170"     -> 8517000
//   "1.234,56"  -> 123456
//   "85,17"     -> 8517     (R$ 85,17)
// Evita o erro de Number("85.170") === 85.17.
export function reaisParaCentavos(input: string | number): number {
  if (typeof input === 'number') return Math.round(input * 100);
  const limpo = input.trim().replace(/[^\d.,]/g, '');
  if (!limpo) return 0;
  // Remove separadores de milhar (.) e usa ',' como decimal.
  const normalizado = limpo.replace(/\./g, '').replace(',', '.');
  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
