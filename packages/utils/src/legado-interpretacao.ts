// Migração do legado — F2 (doc 02 §26.7): leitura da DESCRIÇÃO de cada
// cobrança do Asaas. É ali que vivem seguro, taxa, entrada diluída, acordo,
// reembolso de despesa (IPVA, multa, manutenção). Regras propõem; quando a
// descrição não bate no padrão a proposta vem com DÚVIDA e o operador decide.

export type TipoCobrancaLegada =
  | 'parcela' // parcela semanal do contrato (+ seguro + taxa)
  | 'intermediaria' // entrada diluída (3.2 c)
  | 'entrada' // entrada no ato (3.2 a)
  | 'acordo' // renegociação de atraso
  | 'reembolso' // despesa repassada: IPVA, multa, manutenção, licenciamento…
  | 'outra';

export interface ContextoInterpretacao {
  parcelaContratual: number | null; // centavos — 3.2 b) (ex.: 942,00)
  seguroSemanal: number; // centavos (5.000)
  taxaSemanal: number; // centavos (500)
  intermediariaValor: number | null; // centavos — 3.2 c) (ex.: 500,00)
  entradaValor: number | null; // centavos — 3.2 a)
}

export interface InterpretacaoCobranca {
  tipo: TipoCobrancaLegada;
  // Decomposição do VALOR ORIGINAL da cobrança (sem juros/multa):
  parcelamento: number; // parte do contrato (parcela, entrada, intermediária, acordo…)
  seguro: number;
  taxa: number;
  intermediaria: number; // quando a intermediária veio junto na mesma cobrança
  duvida: boolean;
  motivo: string; // por que a regra chegou aqui (ou por que ficou em dúvida)
}

const reais = (s: string) => {
  const limpo = s.replace(/\./g, '').replace(',', '.');
  const n = Math.round(parseFloat(limpo) * 100);
  return Number.isFinite(n) ? n : null;
};

// "seguro R$ 50", "R$ 50,00 seguro", "+ 50 seguro"
function valorJuntoDe(desc: string, palavra: RegExp): number | null {
  const antes = desc.match(new RegExp(`R?\\$?\\s*([\\d.]+(?:,\\d{2})?)\\s*(?:de\\s+)?(?:${palavra.source})`, 'i'));
  if (antes) return reais(antes[1]);
  const depois = desc.match(new RegExp(`(?:${palavra.source})[^\\dR]{0,12}R?\\$?\\s*([\\d.]+(?:,\\d{2})?)`, 'i'));
  if (depois) return reais(depois[1]);
  return null;
}

export function interpretarCobrancaLegada(params: {
  descricao: string | null | undefined;
  valorOriginal: number; // centavos — sem juros/multa
  avulsa: boolean; // não veio de assinatura
  contexto: ContextoInterpretacao;
}): InterpretacaoCobranca {
  const desc = (params.descricao ?? '').trim();
  const d = desc.toLowerCase();
  const { contexto: c } = params;
  const valor = params.valorOriginal;
  const seguroDesc = valorJuntoDe(desc, /seguro|prote[çc][ãa]o/);
  const taxaDesc = valorJuntoDe(desc, /taxa|mensagens?/);
  const seguro = seguroDesc ?? c.seguroSemanal;
  const taxa = taxaDesc ?? c.taxaSemanal;
  const semItens = (v: number) => v - seguro - taxa;

  const sem = (tipo: TipoCobrancaLegada, parcelamento: number, extra: Partial<InterpretacaoCobranca> & { motivo: string }): InterpretacaoCobranca => ({
    tipo, parcelamento, seguro: 0, taxa: 0, intermediaria: 0, duvida: false, ...extra,
  });

  // 1. Acordo / renegociação
  if (/acordo|renegocia|negocia[çc][ãa]o|parcelamento de atraso|atrasad[ao]s? renegoc/.test(d)) {
    return sem('acordo', valor, { motivo: 'descrição fala em acordo/renegociação' });
  }
  // 2. Reembolso de despesa (3.5 do contrato)
  if (/ipva|licenciamento|multa(?!\s*de\s*\d)|manuten[çc][ãa]o|reembolso|despesa|guincho|oficina|pe[çc]a|revis[ãa]o|pneu|rastreador avulso|dpvat|ped[áa]gio|vistoria/.test(d)) {
    return sem('reembolso', valor, { motivo: 'descrição fala em despesa repassada (IPVA, multa, manutenção…)' });
  }
  // 3. Parcela semanal pelo VALOR exato vem antes das palavras: uma cobrança
  //    "parcela + intermediária" é parcela com a intermediária embutida.
  const p0 = c.parcelaContratual;
  if (p0 != null && valor === p0 + seguro + taxa) {
    return { tipo: 'parcela', parcelamento: p0, seguro, taxa, intermediaria: 0, duvida: false, motivo: 'valor = parcela + seguro + taxa' };
  }
  if (p0 != null && c.intermediariaValor != null && valor === p0 + seguro + taxa + c.intermediariaValor) {
    return { tipo: 'parcela', parcelamento: p0, seguro, taxa, intermediaria: c.intermediariaValor, duvida: false, motivo: 'valor = parcela + seguro + taxa + intermediária' };
  }
  // 4. Entrada no ato vs. diluída
  if (/intermedi|dilu[íi]d/.test(d)) {
    return sem('intermediaria', valor, { motivo: 'descrição fala em parcela intermediária / entrada diluída' });
  }
  if (/entrada|sinal/.test(d)) {
    const bate = c.entradaValor != null && valor === c.entradaValor;
    return sem('entrada', valor, { motivo: bate ? 'entrada, valor igual ao do contrato' : 'entrada (valor diferente do contrato — conferir)', duvida: !bate });
  }
  // 4. Parcela semanal — pelo valor, com ou sem intermediária junto
  const p = c.parcelaContratual;
  if (p != null) {
    if (valor === p + seguro + taxa) {
      return { tipo: 'parcela', parcelamento: p, seguro, taxa, intermediaria: 0, duvida: false, motivo: 'valor = parcela + seguro + taxa' };
    }
    if (c.intermediariaValor != null && valor === p + seguro + taxa + c.intermediariaValor) {
      return { tipo: 'parcela', parcelamento: p, seguro, taxa, intermediaria: c.intermediariaValor, duvida: false, motivo: 'valor = parcela + seguro + taxa + intermediária' };
    }
    if (valor === p) {
      return { tipo: 'parcela', parcelamento: p, seguro: 0, taxa: 0, intermediaria: 0, duvida: true, motivo: 'valor = parcela SEM seguro e taxa — confirmar' };
    }
    if (c.intermediariaValor != null && valor === c.intermediariaValor) {
      return sem('intermediaria', valor, { motivo: 'valor igual ao da parcela intermediária (cobrada à parte)' });
    }
  }
  if (/parcela|semanal|semana/.test(d) || (!params.avulsa && p == null)) {
    const parcelamento = semItens(valor);
    return {
      tipo: 'parcela', parcelamento: Math.max(parcelamento, 0), seguro: parcelamento > 0 ? seguro : 0, taxa: parcelamento > 0 ? taxa : 0, intermediaria: 0,
      duvida: true,
      motivo: p == null ? 'parcela, mas os termos ainda não dizem o valor contratual' : `parcela com valor fora do padrão (${(valor / 100).toFixed(2)} ≠ ${((p + seguro + taxa) / 100).toFixed(2)})`,
    };
  }
  return sem('outra', valor, { duvida: true, motivo: desc ? 'descrição não bate em nenhum padrão' : 'cobrança sem descrição' });
}

// Contexto a partir dos termos + proposta de decomposição (§26.2).
export function contextoDosTermos(t: {
  parcelas: { valor: number | null };
  intermediarias: { valor: number | null } | null;
  entradaValor: number | null;
  seguroSemanal: number;
  taxaSemanal: number;
} | null, parcelaPadraoCobrada: number | null): ContextoInterpretacao {
  const seguro = t?.seguroSemanal ?? 5_000;
  const taxa = t?.taxaSemanal ?? 500;
  let parcelaContratual = t?.parcelas.valor ?? null;
  // Sem termos ainda: infere da parcela padrão cobrada (997 → 942).
  if (parcelaContratual == null && parcelaPadraoCobrada != null && parcelaPadraoCobrada > seguro + taxa) {
    parcelaContratual = parcelaPadraoCobrada - seguro - taxa;
  }
  return {
    parcelaContratual,
    seguroSemanal: seguro,
    taxaSemanal: taxa,
    intermediariaValor: t?.intermediarias?.valor ?? null,
    entradaValor: t?.entradaValor ?? null,
  };
}
