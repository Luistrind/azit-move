// Fronteira monetária (conflito sinalizado: api-spec §1 trafega centavos inteiros,
// o banco guarda Decimal(12,2) em reais — Regra 10 do CLAUDE.md: nunca Float para dinheiro).
// O domínio opera em CENTAVOS INTEIROS para evitar erro de ponto flutuante; a conversão
// para reais (Decimal/string) acontece só na borda com o Prisma. Centralizado aqui.

/** Converte reais (number ou string "997.00") para centavos inteiros. */
export function reaisParaCentavos(reais: number | string): number {
  const n = typeof reais === 'string' ? Number(reais) : reais;
  return Math.round(n * 100);
}

/** Converte centavos inteiros para uma string de reais com 2 casas (segura p/ Prisma Decimal). */
export function centavosParaReaisString(centavos: number): string {
  return (Math.round(centavos) / 100).toFixed(2);
}

/** Converte centavos inteiros para number em reais (uso de leitura/exibição, não de cálculo). */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}
