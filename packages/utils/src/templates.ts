// Motor de templates (Doc 7 item 7.9). Transversal: serve formalização (contrato),
// e futuramente notificação extrajudicial e termo de quitação. Funções PURAS.
//
// renderTemplate substitui {{chave}} pelos valores; placeholder ausente vira ''
// (não quebra o fluxo). valorPorExtenso/dataPorExtenso são auxiliares de formatação.

export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, chave: string) => {
    const v = vars[chave];
    return v === undefined || v === null ? '' : String(v);
  });
}

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 10) partes.push(UNIDADES[resto]);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

// Inteiro por extenso (0..999.999.999). Suficiente para valores monetários do domínio.
export function numeroPorExtenso(n: number): string {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const centenas = n % 1000;
  const partes: string[] = [];
  if (milhoes) partes.push(`${milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`}`);
  if (milhares) partes.push(`${milhares === 1 ? 'mil' : `${ate999(milhares)} mil`}`);
  if (centenas) partes.push(ate999(centenas));
  return partes.join(' e ');
}

// Valor em CENTAVOS por extenso: "mil reais e cinquenta centavos".
export function valorPorExtenso(centavos: number): string {
  const reais = Math.floor(centavos / 100);
  const cent = centavos % 100;
  const pReais = reais === 1 ? 'um real' : `${numeroPorExtenso(reais)} reais`;
  if (cent === 0) return pReais;
  const pCent = cent === 1 ? 'um centavo' : `${numeroPorExtenso(cent)} centavos`;
  return `${pReais} e ${pCent}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Data por extenso em UTC (casa com a convenção de datas do sistema): "8 de junho de 2026".
export function dataPorExtenso(d: Date | string): string {
  const data = new Date(d);
  return `${data.getUTCDate()} de ${MESES[data.getUTCMonth()]} de ${data.getUTCFullYear()}`;
}
