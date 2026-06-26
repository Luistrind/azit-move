// Geração do cronograma de parcelas (Doc 5 §11.3, Doc 7 item 3.3). Função PURA —
// sem banco. Compartilhada entre o backend (originação) e o seed.
//
// Regra de valor (decisão de domínio): parcelas 1..n-1 = valorParcela; a ÚLTIMA
// absorve o arredondamento para que a soma == valorTotal (fecha o razão ao centavo).
// Tudo em CENTAVOS inteiros. Reajuste IPCA é fluxo separado (não entra aqui).

export type PeriodicidadeCronograma = 'semanal' | 'quinzenal' | 'mensal';

export interface ParametrosCronograma {
  numeroParcelas: number;
  valorParcela: number; // centavos — valor de cada parcela 1..n-1
  valorTotal: number; // centavos — soma alvo (ex: saldo devedor pós-entrada)
  dataPrimeiraParcela: Date | string;
  periodicidade: PeriodicidadeCronograma;
}

export interface ParcelaCronograma {
  numero: number;
  totalParcelas: number;
  display: string; // "14/157"
  valorNominal: number; // centavos
  dataVencimento: Date;
}

const DIA_MS = 24 * 60 * 60 * 1000;

// Aritmética em UTC puro — determinística independente do fuso do servidor
// (casa com a convenção UTC-meia-noite das datas do sistema).
function vencimento(
  base: Date,
  indiceZero: number,
  periodicidade: PeriodicidadeCronograma,
): Date {
  if (periodicidade === 'semanal') {
    return new Date(base.getTime() + indiceZero * 7 * DIA_MS);
  }
  if (periodicidade === 'quinzenal') {
    return new Date(base.getTime() + indiceZero * 14 * DIA_MS);
  }
  // mensal: soma meses no calendário UTC, com clamp do dia ao fim do mês
  // (ex: 31/jan + 1 mês -> 28/fev).
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth() + indiceZero;
  const dia = base.getUTCDate();
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDiaDoMes)));
}

export function gerarCronograma(p: ParametrosCronograma): ParcelaCronograma[] {
  const n = p.numeroParcelas;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('numeroParcelas deve ser inteiro >= 1');
  }
  const base = new Date(p.dataPrimeiraParcela);
  const somaAnteriores = p.valorParcela * (n - 1);
  const ultima = p.valorTotal - somaAnteriores;

  const parcelas: ParcelaCronograma[] = [];
  for (let i = 1; i <= n; i++) {
    parcelas.push({
      numero: i,
      totalParcelas: n,
      display: `${i}/${n}`,
      valorNominal: i < n ? p.valorParcela : ultima,
      dataVencimento: vencimento(base, i - 1, p.periodicidade),
    });
  }
  return parcelas;
}
