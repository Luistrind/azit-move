// Migração do legado — F2 (doc 02 §26.7): TERMOS do contrato de origem.
//
// O contrato legado é um PDF (PopHub, modelo "Mod06 — Contrato de Promessa
// de Compra e Venda"). Aqui se extrai o que dá do TEXTO do PDF, por regras
// sobre o modelo conhecido, para pré-preencher os termos; o operador confirma.
// Contratos de outro modelo (anteriores ao PopHub) caem no preenchimento
// manual — a extração devolve o que achou e lista o que faltou.

export interface VeiculoTermos {
  marca: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  cor: string | null;
  placa: string | null;
  chassi: string | null;
  renavam: string | null;
  origem: string | null; // locadora | particular | concessionaria (texto livre aqui)
  combustivel: string | null;
  quilometragem: number | null;
}

export interface SerieParcelas {
  total: number | null; // centavos
  quantidade: number | null;
  valor: number | null; // centavos
  primeiraEm: string | null; // YYYY-MM-DD
}

export interface TermosContratoLegado {
  numeroOrigem: string | null;
  dataAssinatura: string | null; // YYYY-MM-DD
  compradorNome: string | null;
  compradorCpf: string | null; // só dígitos
  garantidorNome: string | null;
  garantidorCpf: string | null;
  veiculo: VeiculoTermos;
  valorTotal: number | null; // centavos — 3.1
  entradaValor: number | null; // centavos — 3.2 a) no ato
  parcelas: SerieParcelas; // 3.2 b) — valor do contrato (SÓ o parcelamento, sem seguro/taxa)
  intermediarias: SerieParcelas | null; // 3.2 c) — entrada diluída
  // Itens cobrados junto da parcela (doc 02 §26.2), confirmados pelo operador.
  seguroSemanal: number; // centavos
  taxaSemanal: number; // centavos
  indiceReajuste: string | null; // IPCA
  multaAtrasoPct: number | null; // 2
  jurosMensalPct: number | null; // 1
  garantiaDias: number | null; // 90
  observacoes: string | null;
}

export const TERMOS_VAZIOS: TermosContratoLegado = {
  numeroOrigem: null,
  dataAssinatura: null,
  compradorNome: null,
  compradorCpf: null,
  garantidorNome: null,
  garantidorCpf: null,
  veiculo: {
    marca: null, modelo: null, anoFabricacao: null, anoModelo: null, cor: null,
    placa: null, chassi: null, renavam: null, origem: null, combustivel: null, quilometragem: null,
  },
  valorTotal: null,
  entradaValor: null,
  parcelas: { total: null, quantidade: null, valor: null, primeiraEm: null },
  intermediarias: null,
  seguroSemanal: 5_000,
  taxaSemanal: 500,
  indiceReajuste: null,
  multaAtrasoPct: null,
  jurosMensalPct: null,
  garantiaDias: null,
  observacoes: null,
};

// Campos que a validação (F2) exige preenchidos.
export const CAMPOS_OBRIGATORIOS_TERMOS = [
  'numeroOrigem', 'dataAssinatura', 'compradorCpf', 'veiculo.placa', 'veiculo.chassi',
  'valorTotal', 'entradaValor', 'parcelas.quantidade', 'parcelas.valor', 'parcelas.primeiraEm',
] as const;

export function camposFaltantesTermos(t: TermosContratoLegado): string[] {
  const faltam: string[] = [];
  for (const campo of CAMPOS_OBRIGATORIOS_TERMOS) {
    const [a, b] = campo.split('.');
    const v = b ? (t as unknown as Record<string, Record<string, unknown>>)[a]?.[b] : (t as unknown as Record<string, unknown>)[a];
    if (v === null || v === undefined || v === '') faltam.push(campo);
  }
  return faltam;
}

// ---- extração do texto do PDF (modelo Mod06) ----

const MESES: Record<string, string> = {
  janeiro: '01', fevereiro: '02', marco: '03', março: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

export function reaisTextoParaCentavos(s: string | null | undefined): number | null {
  if (!s) return null;
  const limpo = s.replace(/[^\d,]/g, '');
  if (!limpo) return null;
  const [inteiro, dec = '00'] = limpo.split(',');
  const n = parseInt(inteiro || '0', 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
  return Number.isFinite(n) ? n : null;
}

function dataBRParaISO(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function pega(texto: string, re: RegExp): string | null {
  const m = texto.match(re);
  return m?.[1]?.trim() || null;
}

export interface ExtracaoTermos {
  termos: TermosContratoLegado;
  extraidos: string[];
  faltantes: string[];
  modeloReconhecido: boolean;
}

export function extrairTermosDoTexto(textoBruto: string): ExtracaoTermos {
  // O texto do PDF quebra frases em linhas; normaliza para as regras enxergarem a frase inteira.
  const t = textoBruto.replace(/\r/g, '').replace(/-- \d+ of \d+ --/g, ' ').replace(/SuperSign: [0-9a-f-]+/gi, ' ').replace(/\s+/g, ' ');
  const termos: TermosContratoLegado = JSON.parse(JSON.stringify(TERMOS_VAZIOS));
  const extraidos: string[] = [];
  const marca = (campo: string, ok: unknown) => { if (ok !== null && ok !== undefined && ok !== '') extraidos.push(campo); };

  const modeloReconhecido = /PROMESSA DE COMPRA E VENDA DE VE[ÍI]CULO/i.test(t) && /Condi[çc][õo]es de Pagamento/i.test(t);

  termos.numeroOrigem = pega(t, /N[ºo°]\s*(\d{6,})/);
  marca('numeroOrigem', termos.numeroOrigem);

  const dataAss = t.match(/[A-Za-zÀ-ú ]+\/[A-Z]{2},\s*(\d{1,2}) de ([A-Za-zçÇ]+) de (\d{4})\./);
  if (dataAss) {
    const mes = MESES[dataAss[2].toLowerCase()];
    if (mes) termos.dataAssinatura = `${dataAss[3]}-${mes}-${dataAss[1].padStart(2, '0')}`;
  }
  marca('dataAssinatura', termos.dataAssinatura);

  // Comprador: "A) Nome Completo, brasileiro(a), ... CPF nº 000.000.000-00"
  const comprador = t.match(/COMPRADOR:\s*A\)\s*([^,]+),[^]*?CPF n[ºo°]\s*([\d.\-]+)/i);
  if (comprador) {
    termos.compradorNome = comprador[1].trim();
    termos.compradorCpf = comprador[2].replace(/\D/g, '');
  }
  marca('compradorNome', termos.compradorNome);
  marca('compradorCpf', termos.compradorCpf);

  // Garantidor (quando houver): "GARANTIDOR: Nome, ... CPF nº"
  const garantidor = t.match(/(?:INTERVENIENTE\s+)?GARANTIDOR:\s*([^,]+),[^]*?CPF n[ºo°]\s*([\d.\-]+)/i);
  if (garantidor && !/quando houver/i.test(garantidor[0].slice(0, 60))) {
    termos.garantidorNome = garantidor[1].trim();
    termos.garantidorCpf = garantidor[2].replace(/\D/g, '');
    marca('garantidor', termos.garantidorCpf);
  }

  // Veículo
  const marcaModelo = pega(t, /Marca\/Modelo:\s*([^:]+?)\s+Ano de Fabrica/i);
  if (marcaModelo) {
    const [m, ...resto] = marcaModelo.split('/');
    termos.veiculo.marca = m.trim();
    termos.veiculo.modelo = resto.join('/').trim() || null;
  }
  const anos = t.match(/Ano de Fabrica[çc][ãa]o\/Modelo:\s*(\d{4})\/(\d{4})/i);
  if (anos) { termos.veiculo.anoFabricacao = +anos[1]; termos.veiculo.anoModelo = +anos[2]; }
  termos.veiculo.cor = pega(t, /Cor:\s*([A-Za-zÀ-ú ]+?)\s+(?:Placa|Chassi|RENAVAM)/i);
  termos.veiculo.placa = pega(t, /Placa:\s*([A-Z]{3}\s?-?\s?\d[A-Z0-9]\d{2})/i)?.replace(/[\s-]/g, '').toUpperCase() ?? null;
  termos.veiculo.chassi = pega(t, /Chassi:\s*([A-HJ-NPR-Z0-9]{17})/i)?.toUpperCase() ?? null;
  termos.veiculo.renavam = pega(t, /RENAVAM:\s*(\d{9,11})/i);
  termos.veiculo.origem = pega(t, /Origem:\s*([A-Za-zÀ-ú]+)/i)?.toLowerCase() ?? null;
  termos.veiculo.combustivel = pega(t, /Tipo de Combust[íi]vel:\s*([A-Za-zÀ-ú]+)/i)?.toLowerCase() ?? null;
  const km = pega(t, /Quilometragem:\s*([\d.]+)/i);
  termos.veiculo.quilometragem = km ? parseInt(km.replace(/\D/g, ''), 10) : null;
  for (const k of ['marca', 'modelo', 'placa', 'chassi', 'renavam'] as const) marca(`veiculo.${k}`, termos.veiculo[k]);

  // 3.1 / 3.2
  // [^]*? e não [^R]*: com a flag i, [^R] excluiria também o "r" de "valor".
  termos.valorTotal = reaisTextoParaCentavos(pega(t, /Valor Total:[^]*?R\$\s*([\d.]+,\d{2})/i));
  marca('valorTotal', termos.valorTotal);
  termos.entradaValor = reaisTextoParaCentavos(pega(t, /Entrada:\s*R\$\s*([\d.]+,\d{2})/i));
  marca('entradaValor', termos.entradaValor);

  const parc = t.match(/Parcelas:\s*R\$\s*([\d.]+,\d{2})[^]*?em\s*(\d+)\s*\([^)]*\)\s*parcelas[^]*?R\$\s*([\d.]+,\d{2})[^]*?primeira em\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (parc) {
    termos.parcelas = { total: reaisTextoParaCentavos(parc[1]), quantidade: +parc[2], valor: reaisTextoParaCentavos(parc[3]), primeiraEm: dataBRParaISO(parc[4]) };
    extraidos.push('parcelas');
  }
  const inter = t.match(/Parcelas Intermedi[áa]rias:\s*R\$\s*([\d.]+,\d{2})[^]*?em\s*(\d+)\s*\([^)]*\)\s*parcelas[^]*?R\$\s*([\d.]+,\d{2})[^]*?primeira em\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (inter) {
    termos.intermediarias = { total: reaisTextoParaCentavos(inter[1]), quantidade: +inter[2], valor: reaisTextoParaCentavos(inter[3]), primeiraEm: dataBRParaISO(inter[4]) };
    extraidos.push('intermediarias');
  }

  if (/IPCA/.test(t)) termos.indiceReajuste = 'IPCA';
  const multa = pega(t, /multa de\s*(\d+(?:,\d+)?)\s*%/i);
  termos.multaAtrasoPct = multa ? parseFloat(multa.replace(',', '.')) : null;
  const juros = pega(t, /juros morat[óo]rios de\s*(\d+(?:,\d+)?)\s*%/i);
  termos.jurosMensalPct = juros ? parseFloat(juros.replace(',', '.')) : null;
  const garantia = pega(t, /(\d+)\s*\([^)]*\)\s*dias corridos/i);
  termos.garantiaDias = garantia ? +garantia : null;

  return { termos, extraidos, faltantes: camposFaltantesTermos(termos), modeloReconhecido };
}
