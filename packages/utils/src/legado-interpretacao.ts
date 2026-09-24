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
  // Despesa repassada JUNTO da parcela (caso real 23/09: "Manutenção Periódica
  // R$ 225,75" na mesma cobrança da semana) — é o produto de reembolso, não
  // muda a parcela do contrato.
  extra: number;
  extraRotulo: string | null;
  // Juros/multa EMBUTIDOS no valor da cobrança (caso real 23/09: parcela
  // reemitida por atraso, "… / Multa e juros por atraso." sem valor no texto —
  // o encargo é o que sobra depois das partes). Não é parcela nem despesa.
  encargo: number;
  duvida: boolean;
  motivo: string; // por que a regra chegou aqui (ou por que ficou em dúvida)
}

// Descrição ESTRUTURADA do Asaas, como a operação escrevia: "Contrato -
// Parcela semanal: R$ 942,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas
// Boleto Pix - Repasse: R$ 5,00 / Manutenção Corretiva R$ 331,36 - 01/04".
// Cada trecho com valor vira uma parte rotulada.
export interface ParteRotulada {
  rotulo: string;
  valor: number; // centavos
  papel: 'parcelamento' | 'seguro' | 'taxa' | 'intermediaria' | 'entrada' | 'extra' | 'encargo';
}

export function partesRotuladas(descricao: string): ParteRotulada[] {
  // Só o formato por segmentos ("A: R$ x / B: R$ y / C R$ z"), com exatamente
  // UM valor em cada segmento. Formatos soltos ("R$ 50 seguro + R$ 5 taxa")
  // ficam para as regras por palavra, que leem o rótulo depois do valor.
  // Separador é " / " com espaços ou "//" (caso real 23/09: "… R$ 5,00// 1ª
  // Cota do IPVA 2026") — uma data "01/04" no fim do rótulo não corta.
  const segmentos = descricao.split(/\s*\/\/\s*|\s+\/\s+/).map((s) => s.trim()).filter(Boolean);
  if (segmentos.length < 2) return [];
  const partes: ParteRotulada[] = [];
  for (const seg of segmentos) {
    // Valores como "R$ 942,00", "$1.320.00" ou "$323,00" (a operação escrevia dos dois jeitos).
    const valores = [...seg.matchAll(/R?\$\s*([\d.]+(?:[,.]\d{2})?)/g)];
    if (valores.length === 0) {
      // Segmento SEM valor: aviso de encargo ("Multa e juros por atraso") vale o
      // que sobrar; qualquer outro ("1ª Cota do IPVA 2026") é despesa junto da
      // parcela e também recebe o que sobrar (papel extra, valor 0 = a definir).
      const rot = seg.replace(/[.\s]+$/g, '');
      if (/juros|multa|atraso|encargo|mora/i.test(seg)) { partes.push({ rotulo: rot, valor: 0, papel: 'encargo' }); continue; }
      partes.push({ rotulo: rot, valor: 0, papel: 'extra' });
      continue;
    }
    if (valores.length !== 1) return [];
    const valor = valorMonetario(valores[0][1]);
    if (valor == null) return [];
    const rotulo = seg.slice(0, valores[0].index).replace(/[\s\-–:]+$/g, '').trim() || 'valor';
    const r = rotulo.toLowerCase();
    const papel: ParteRotulada['papel'] =
      /intermedi|dilu[íi]d/.test(r) ? 'intermediaria'
        : /entrada|sinal|reserva/.test(r) ? 'entrada'
          : /prote[çc][ãa]o|seguro/.test(r) ? 'seguro'
            : /taxa|boleto|pix|mensag/.test(r) ? 'taxa'
              // 'Parcelamento'/'Parcelamenti' é despesa parcelada (repasse), não a
              // parcela do contrato; e só existe UMA parcela do contrato por cobrança.
              : /parcelament/.test(r) ? 'extra'
                : /parcela|semanal|contrato|financiamento/.test(r) && !partes.some((x) => x.papel === 'parcelamento') ? 'parcelamento'
                  : 'extra';
    partes.push({ rotulo, valor, papel });
  }
  return partes;
}

// "942,00" · "1.320,00" · "1.320.00" (ponto como decimal, jeito da operação) · "323,00"
export function valorMonetario(s: string): number | null {
  const limpo = s.trim();
  let n: number;
  if (/,\d{2}$/.test(limpo)) n = parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
  else if (/\.\d{2}$/.test(limpo) && (limpo.match(/\./g) ?? []).length >= 1) n = parseFloat(limpo.replace(/\.(?=\d{3}\b)/g, ''));
  else n = parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
  const c = Math.round(n * 100);
  return Number.isFinite(c) ? c : null;
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
    tipo, parcelamento, seguro: 0, taxa: 0, intermediaria: 0, extra: 0, extraRotulo: null, encargo: 0, duvida: false, ...extra,
  });

  // 0. Descrição ESTRUTURADA (rótulo: R$ valor / rótulo: R$ valor …): a
  //    composição vem da própria descrição — inclusive despesa repassada junto
  //    da parcela (caso real 23/09). Partes CONHECIDAS (parcela, seguro, taxa,
  //    intermediária, entrada) têm valor escrito; o que sobra da cobrança vai
  //    para a despesa junto (cota do IPVA, manutenção parcelada — o valor
  //    escrito nela às vezes é o TOTAL do parcelamento, "$1.320.00 (1/5)") ou,
  //    sem despesa, para juros/multa embutidos (parcela reemitida por atraso).
  const partes = partesRotuladas(desc);
  const conhecidas = partes.filter((x) => x.papel !== 'extra' && x.papel !== 'encargo');
  const somaConhecidas = conhecidas.reduce((s, x) => s + x.valor, 0);
  const extras = partes.filter((x) => x.papel === 'extra');
  const temAvisoEncargo = partes.some((x) => x.papel === 'encargo');
  const temParcelamento = partes.some((x) => x.papel === 'parcelamento');
  if (partes.length >= 2 && somaConhecidas > 0 && valor >= somaConhecidas) {
    let residual = valor - somaConhecidas;
    let extraValor = 0;
    let encargoEmbutido = 0;
    if (extras.length) {
      const somaExtras = extras.reduce((s, x) => s + x.valor, 0);
      // Valor escrito nas despesas fecha com o que sobra (ou fecha e ainda sobram
      // juros avisados)? Usa o escrito. Senão, a despesa é o que sobra.
      if (somaExtras > 0 && somaExtras <= residual && (somaExtras === residual || temAvisoEncargo)) {
        extraValor = somaExtras;
      } else {
        extraValor = residual;
      }
      residual -= extraValor;
    }
    if (residual > 0) {
      // Juros/multa embutidos: com aviso, o que sobrar; sem aviso, só até 20%
      // das partes conhecidas (acima disso fica em dúvida para o operador).
      if (temAvisoEncargo || (temParcelamento && residual <= Math.round(somaConhecidas * 0.2))) {
        encargoEmbutido = residual;
        residual = 0;
      }
    }
    const fechou = residual === 0;
    const soma = (papel: ParteRotulada['papel']) => partes.filter((x) => x.papel === papel).reduce((s, x) => s + x.valor, 0);
    const parcelamento = soma('parcelamento');
    const entradaParte = soma('entrada');
    const rotuloExtras = extras.length ? extras.map((x) => x.rotulo).join(' + ') : null;
    if (parcelamento > 0 && fechou) {
      const p0 = c.parcelaContratual;
      const bate = p0 == null || parcelamento === p0;
      return {
        tipo: 'parcela',
        parcelamento,
        seguro: soma('seguro'),
        taxa: soma('taxa'),
        intermediaria: soma('intermediaria') + entradaParte,
        extra: extraValor,
        extraRotulo: extraValor > 0 ? rotuloExtras : null,
        encargo: encargoEmbutido,
        duvida: !bate,
        motivo: bate
          ? `composição lida da descrição${extraValor ? ` (com ${rotuloExtras} ${(extraValor / 100).toFixed(2)})` : ''}${encargoEmbutido ? ` (juros/multa embutidos: ${(encargoEmbutido / 100).toFixed(2)}${temAvisoEncargo ? '' : ', sem aviso na descrição'})` : ''}`
          : `composição lida da descrição, mas a parcela (${(parcelamento / 100).toFixed(2)}) difere do contrato (${((p0 ?? 0) / 100).toFixed(2)})`,
      };
    }
    if (parcelamento === 0 && entradaParte > 0 && fechou && extraValor === 0) {
      return sem('entrada', valor, { motivo: 'entrada, pela descrição' });
    }
    if (parcelamento === 0 && extras.length && fechou) {
      return sem('reembolso', valor, { extra: valor, extraRotulo: rotuloExtras, motivo: 'despesa repassada, pela descrição' });
    }
  }

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
    return { tipo: 'parcela', parcelamento: p0, seguro, taxa, intermediaria: 0, extra: 0, extraRotulo: null, encargo: 0, duvida: false, motivo: 'valor = parcela + seguro + taxa' };
  }
  if (p0 != null && c.intermediariaValor != null && valor === p0 + seguro + taxa + c.intermediariaValor) {
    return { tipo: 'parcela', parcelamento: p0, seguro, taxa, intermediaria: c.intermediariaValor, extra: 0, extraRotulo: null, encargo: 0, duvida: false, motivo: 'valor = parcela + seguro + taxa + intermediária' };
  }
  // 4. Entrada no ato vs. diluída
  if (/intermedi|dilu[íi]d/.test(d)) {
    return sem('intermediaria', valor, { motivo: 'descrição fala em parcela intermediária / entrada diluída' });
  }
  // "reserva" e "complemento" (caso real 23/09: "Taxa de reserva da Placa",
  //  "Complemento de entrada") são partes da entrada — ela pode ter sido paga
  //  em várias transações; a conciliação soma as partes.
  if (/entrada|sinal|reserva/.test(d)) {
    const bate = c.entradaValor != null && valor === c.entradaValor;
    return sem('entrada', valor, { motivo: bate ? 'entrada, valor igual ao do contrato' : 'parte da entrada (a conciliação soma as partes)', duvida: false });
  }
  // 4. Parcela semanal — pelo valor, com ou sem intermediária junto
  const p = c.parcelaContratual;
  if (p != null) {
    if (valor === p + seguro + taxa) {
      return { tipo: 'parcela', parcelamento: p, seguro, taxa, intermediaria: 0, extra: 0, extraRotulo: null, encargo: 0, duvida: false, motivo: 'valor = parcela + seguro + taxa' };
    }
    if (c.intermediariaValor != null && valor === p + seguro + taxa + c.intermediariaValor) {
      return { tipo: 'parcela', parcelamento: p, seguro, taxa, intermediaria: c.intermediariaValor, extra: 0, extraRotulo: null, encargo: 0, duvida: false, motivo: 'valor = parcela + seguro + taxa + intermediária' };
    }
    if (valor === p) {
      return { tipo: 'parcela', parcelamento: p, seguro: 0, taxa: 0, intermediaria: 0, extra: 0, extraRotulo: null, encargo: 0, duvida: true, motivo: 'valor = parcela SEM seguro e taxa — confirmar' };
    }
    if (c.intermediariaValor != null && valor === c.intermediariaValor) {
      return sem('intermediaria', valor, { motivo: 'valor igual ao da parcela intermediária (cobrada à parte)' });
    }
  }
  if (/parcela|semanal|semana/.test(d) || (!params.avulsa && p == null)) {
    const parcelamento = semItens(valor);
    return {
      tipo: 'parcela', parcelamento: Math.max(parcelamento, 0), seguro: parcelamento > 0 ? seguro : 0, taxa: parcelamento > 0 ? taxa : 0, intermediaria: 0, extra: 0, extraRotulo: null, encargo: 0,
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
