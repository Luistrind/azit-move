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

// Número decimal em formato BR → number. Heurística para ponto único:
//   "4.5"  -> 4.5   (não parece milhar: casa decimal com 1-2 dígitos)
//   "35.000" -> 35000, "1.234.567" -> 1234567 (pontos de milhar)
//   "4,5" -> 4.5, "1.234,56" -> 1234.56
export function numeroBR(input: string | number): number {
  if (typeof input === 'number') return input;
  const limpo = input.trim().replace(/[^\d.,-]/g, '');
  if (!limpo) return 0;
  let normalizado: string;
  if (limpo.includes(',')) {
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else {
    const partes = limpo.split('.');
    normalizado = partes.length === 2 && partes[1].length !== 3 ? limpo : partes.join('');
  }
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

// Inteiro em formato BR ("35.000" -> 35000). Vazio -> undefined.
export function inteiroBR(input: string): number | undefined {
  if (input.trim() === '') return undefined;
  return Math.round(numeroBR(input));
}
