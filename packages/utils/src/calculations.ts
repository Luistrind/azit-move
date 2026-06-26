/**
 * Calcula o valor presente de uma parcela futura para quitação antecipada.
 * Fórmula validada com Vicente em 23/06 (Doc 2 §7.4):
 *
 *   VP = VF / (1 + taxa)^tempo
 *
 * @param vf    Valor futuro da parcela (na mesma unidade do retorno — centavos no domínio)
 * @param taxa  Taxa diária parametrizável (ex: 0.001 = 0,1% ao dia)
 * @param tempo Número de dias entre a data de referência e o vencimento
 */
export function calcularValorPresente(
  vf: number,
  taxa: number,
  tempo: number,
): number {
  return vf / Math.pow(1 + taxa, tempo);
}

/**
 * Calcula o total de quitação antecipada para um conjunto de parcelas.
 * O valor de quitação total é a soma dos VP de cada parcela restante (Doc 2 §7.4).
 */
export function calcularQuitacaoTotal(
  parcelas: Array<{ valorFuturo: number; diasAteVencimento: number }>,
  taxa: number,
): number {
  return parcelas.reduce(
    (acc, p) =>
      acc + calcularValorPresente(p.valorFuturo, taxa, p.diasAteVencimento),
    0,
  );
}

/**
 * Encargo por atraso (Doc 2 §7.2):
 *   encargo = valor * (multa%) + valor * (juros% / 30) * dias_atraso
 * Taxas em pontos percentuais (multa 2 = 2%, juros 1 = 1% ao mês pro-rata die).
 * Calculado internamente para conciliação, independente do que o Asaas retornar.
 */
export function calcularEncargoAtraso(
  valor: number,
  diasAtraso: number,
  taxaMultaPercent = 2,
  taxaJurosMensalPercent = 1,
): number {
  if (diasAtraso <= 0) return 0;
  const multa = valor * (taxaMultaPercent / 100);
  const juros = valor * (taxaJurosMensalPercent / 100 / 30) * diasAtraso;
  return multa + juros;
}
