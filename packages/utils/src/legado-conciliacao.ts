// Migração do legado — F2 (doc 02 §26.7): CONCILIAÇÃO do cronograma esperado
// (termos do contrato) com as cobranças reais do Asaas. Por data (±3 dias) e
// valor. Puro: recebe termos + cobranças já interpretadas, devolve linha a
// linha o que bate, o que diverge e o que ficou fora do cronograma.

import type { TipoCobrancaLegada } from './legado-interpretacao';

export interface CobrancaConciliavel {
  id: string;
  vencimento: string; // YYYY-MM-DD
  valorOriginal: number; // centavos, sem juros/multa
  valorPago: number | null; // centavos, o que entrou (pode incluir encargo)
  pagoEm: string | null;
  classe: 'paga' | 'pendente' | 'vencida' | 'outra';
  tipo: TipoCobrancaLegada;
  intermediariaEmbutida: number; // centavos — quando a intermediária veio na mesma cobrança
  // Composição lida da descrição (23/09): a parte de PARCELA do contrato dentro
  // da cobrança e a despesa repassada junto dela (manutenção etc.).
  parcelamento: number | null;
  extra: number;
  extraRotulo: string | null;
  encargoEmbutido: number; // juros/multa dentro do valor (parcela reemitida por atraso)
  descricao: string | null;
}

export interface TermosConciliaveis {
  parcelas: { quantidade: number | null; valor: number | null; primeiraEm: string | null };
  intermediarias: { quantidade: number | null; valor: number | null; primeiraEm: string | null } | null;
  entradaValor: number | null;
  seguroSemanal: number;
  taxaSemanal: number;
}

export type SituacaoLinha =
  | 'paga'
  | 'paga_com_encargo' // pagou depois do vencimento, com juros/multa
  | 'pendente'
  | 'vencida'
  | 'nao_cobrada' // já deveria ter sido emitida e não há cobrança
  | 'futura' // ainda não chegou a hora de emitir
  | 'valor_diverge'; // há cobrança na data, mas o valor não é o esperado

export interface LinhaConciliacao {
  chave: string; // parcela:N | intermediaria:N | entrada
  serie: 'parcela' | 'intermediaria' | 'entrada';
  numero: number;
  esperadoEm: string;
  esperadoValor: number; // centavos — o que a cobrança deveria valer
  cobrancaId: string | null;
  cobradoEm: string | null;
  cobradoValor: number | null;
  pagoEm: string | null;
  pagoValor: number | null;
  encargo: number; // pagoValor - cobradoValor quando positivo
  situacao: SituacaoLinha;
  divergencia: boolean;
  // O que veio JUNTO na cobrança além da parcela do contrato (não é divergência).
  componentes: { seguro: number; taxa: number; intermediaria: number; extra: number; extraRotulo: string | null } | null;
  // Entrada paga em várias transações (23/09): as partes somadas.
  partes: { cobrancaId: string; vencimento: string; valor: number; classe: CobrancaConciliavel['classe'] }[];
  // Cobrança reemitida por atraso (vencimento depois do esperado): explica a data.
  observacao: string | null;
}

export interface ForaDoCronograma {
  cobrancaId: string;
  vencimento: string;
  valorOriginal: number;
  tipo: TipoCobrancaLegada;
  classe: CobrancaConciliavel['classe'];
  descricao: string | null;
  motivo: string;
  divergencia: boolean; // parcela/intermediária que não casou com nenhuma data = divergência
}

export interface ResumoConciliacao {
  parcelasEsperadas: number;
  parcelasPagas: number;
  parcelasPendentes: number;
  parcelasVencidas: number;
  parcelasNaoCobradas: number;
  parcelasFuturas: number;
  intermediariasPagas: number;
  intermediariasEsperadas: number;
  entradaPaga: boolean | null; // null = sem entrada nos termos
  encargosPagos: number; // centavos — juros/multa que o cliente já pagou
  saldoContratualRestante: number; // centavos — parcelas não pagas × valor contratual (sem seguro/taxa)
  divergencias: number;
  cobrancasForaDoCronograma: number;
}

export interface ResultadoConciliacao {
  linhas: LinhaConciliacao[];
  fora: ForaDoCronograma[];
  resumo: ResumoConciliacao;
  incompleta: boolean; // termos sem o mínimo (quantidade, valor, 1ª parcela)
}

const DIA_MS = 86_400_000;
const isoMaisDias = (iso: string, dias: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / DIA_MS);

export function conciliarLegado(params: {
  termos: TermosConciliaveis;
  cobrancas: CobrancaConciliavel[];
  hoje: string; // YYYY-MM-DD
  toleranciaDias?: number;
  // Vínculos MANUAIS (decisão do operador, caso real 23/09): cobrança → linha
  // do cronograma. Acordos e arranjos que regra nenhuma adivinha.
  vinculosManuais?: { cobrancaId: string; chave: string }[];
}): ResultadoConciliacao {
  const { termos, hoje } = params;
  const manuais = new Map<string, string[]>(); // chave → cobrancaIds
  for (const v of params.vinculosManuais ?? []) manuais.set(v.chave, [...(manuais.get(v.chave) ?? []), v.cobrancaId]);
  const tol = params.toleranciaDias ?? 3;
  const p = termos.parcelas;
  if (!p.quantidade || p.valor == null || !p.primeiraEm) {
    return {
      linhas: [], fora: [],
      resumo: { parcelasEsperadas: 0, parcelasPagas: 0, parcelasPendentes: 0, parcelasVencidas: 0, parcelasNaoCobradas: 0, parcelasFuturas: 0, intermediariasPagas: 0, intermediariasEsperadas: 0, entradaPaga: null, encargosPagos: 0, saldoContratualRestante: 0, divergencias: 0, cobrancasForaDoCronograma: 0 },
      incompleta: true,
    };
  }

  const usadas = new Set<string>();
  const cobrancas = params.cobrancas.filter((c) => c.classe !== 'outra');
  const linhas: LinhaConciliacao[] = [];
  const porId = new Map(cobrancas.map((c) => [c.id, c]));
  for (const ids of manuais.values()) for (const id of ids) if (porId.has(id)) usadas.add(id);

  // Linha composta por VÁRIAS cobranças (parcela paga em partes, ou vínculo
  // manual): soma os originais, o pago e os encargos; a situação sai das classes.
  const montarComposta = (serie: LinhaConciliacao['serie'], numero: number, esperadoEm: string, esperadoValor: number, partes: CobrancaConciliavel[], manual: boolean): LinhaConciliacao => {
    const ordenadas = [...partes].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const soma = ordenadas.reduce((s, x) => s + x.valorOriginal, 0);
    const pagas = ordenadas.filter((x) => x.classe === 'paga');
    const somaPaga = pagas.reduce((s, x) => s + (x.valorPago ?? x.valorOriginal), 0);
    const encargo = ordenadas.reduce((s, x) => s + x.encargoEmbutido + (x.classe === 'paga' && x.valorPago != null && x.valorPago > x.valorOriginal ? x.valorPago - x.valorOriginal : 0), 0);
    let situacao: SituacaoLinha;
    if (pagas.length === ordenadas.length) situacao = encargo > 0 ? 'paga_com_encargo' : 'paga';
    else situacao = ordenadas.some((x) => x.classe === 'vencida') ? 'vencida' : 'pendente';
    // Manual: o operador decidiu que estas cobranças quitam a linha — não é divergência
    // mesmo que a soma difira (acordo com desconto, por exemplo). Automática: só vale se soma.
    const diverge = !manual && soma !== esperadoValor;
    return {
      chave: serie === 'entrada' ? 'entrada' : `${serie}:${numero}`,
      serie, numero, esperadoEm, esperadoValor,
      cobrancaId: ordenadas.length === 1 ? ordenadas[0].id : null,
      cobradoEm: ordenadas[0]?.vencimento ?? null,
      cobradoValor: soma,
      pagoEm: pagas.length ? pagas[pagas.length - 1].pagoEm : null,
      pagoValor: pagas.length ? somaPaga : null,
      encargo,
      situacao: diverge ? 'valor_diverge' : situacao,
      divergencia: diverge,
      componentes: null,
      partes: ordenadas.map((x) => ({ cobrancaId: x.id, vencimento: x.vencimento, valor: x.valorOriginal, classe: x.classe })),
      observacao: manual
        ? `vínculo manual (${ordenadas.length} cobrança${ordenadas.length > 1 ? 's' : ''})${soma !== esperadoValor ? ` — soma ${(soma / 100).toFixed(2)} ≠ esperado ${(esperadoValor / 100).toFixed(2)}` : ''}`
        : `paga em ${ordenadas.length} transações`,
    };
  };

  // Intermediárias por data: quando caem na mesma semana da parcela, o Asaas
  // pode ter cobrado junto (valor = parcela + seguro + taxa + intermediária).
  const inter = termos.intermediarias;
  const intermediariasPorData = new Map<string, number>();
  if (inter?.quantidade && inter.valor != null && inter.primeiraEm) {
    for (let i = 0; i < inter.quantidade; i++) intermediariasPorData.set(isoMaisDias(inter.primeiraEm, 7 * i), i + 1);
  }

  const procurar = (tipos: TipoCobrancaLegada[], data: string, valoresAceitos: number[], parcelaAceita: number | null = null) => {
    let melhor: CobrancaConciliavel | null = null;
    let melhorDist = Infinity;
    for (const c of cobrancas) {
      if (usadas.has(c.id) || !tipos.includes(c.tipo)) continue;
      const dist = Math.abs(difDias(c.vencimento, data));
      if (dist > tol) continue;
      // Bate pelo TOTAL ou pela parte de parcela lida da descrição (23/09): uma
      // cobrança "942 + 50 + 5 + manutenção 225,75" é a parcela da semana.
      const exato = valoresAceitos.includes(c.valorOriginal);
      const porComposicao = !exato && c.parcelamento != null && parcelaAceita != null && c.parcelamento === parcelaAceita;
      // Prefere o total exato; depois quem bate só pela composição (ex.: reemitida
      // com juros, que deve sobrar para a semana vazia); entre iguais, a data mais próxima.
      const score = dist + (exato ? 0 : porComposicao ? 1 : 100);
      if (score < melhorDist) { melhorDist = score; melhor = c; }
    }
    return melhor;
  };

  const montar = (serie: LinhaConciliacao['serie'], numero: number, esperadoEm: string, esperadoValor: number, c: CobrancaConciliavel | null, parcelaEsperada: number | null = null): LinhaConciliacao => {
    let situacao: SituacaoLinha;
    let encargo = c?.encargoEmbutido ?? 0;
    const bateComposicao = !!c && parcelaEsperada != null && c.parcelamento != null && c.parcelamento === parcelaEsperada;
    if (!c) {
      situacao = esperadoEm > hoje ? 'futura' : 'nao_cobrada';
    } else if (c.valorOriginal !== esperadoValor && !bateComposicao) {
      situacao = 'valor_diverge';
    } else if (c.classe === 'paga') {
      encargo += c.valorPago != null && c.valorPago > c.valorOriginal ? c.valorPago - c.valorOriginal : 0;
      situacao = encargo > 0 || (c.pagoEm != null && c.pagoEm > c.vencimento) ? 'paga_com_encargo' : 'paga';
    } else {
      // "outra" já foi filtrada antes; aqui só chega pendente/vencida.
      situacao = c.classe === 'vencida' ? 'vencida' : 'pendente';
    }
    return {
      chave: serie === 'entrada' ? 'entrada' : `${serie}:${numero}`,
      serie, numero, esperadoEm, esperadoValor,
      cobrancaId: c?.id ?? null,
      cobradoEm: c?.vencimento ?? null,
      cobradoValor: c?.valorOriginal ?? null,
      pagoEm: c?.pagoEm ?? null,
      pagoValor: c?.valorPago ?? null,
      encargo,
      situacao,
      divergencia: situacao === 'valor_diverge' || situacao === 'nao_cobrada',
      componentes: c && (c.extra > 0 || c.intermediariaEmbutida > 0 || bateComposicao)
        ? { seguro: 0, taxa: 0, intermediaria: c.intermediariaEmbutida, extra: c.extra, extraRotulo: c.extraRotulo }
        : null,
      partes: [],
      observacao: c && Math.abs(difDias(c.vencimento, esperadoEm)) > tol ? `cobrança reemitida para ${c.vencimento.split('-').reverse().join('/')} (atraso)` : null,
    };
  };

  // Entrada no ato — pode ter sido paga em VÁRIAS transações (caso real 23/09:
  // reserva 500 + 1.500 + complemento 500). Soma todas as cobranças lidas como
  // entrada; bate se a soma é o valor do contrato.
  let entradaPaga: boolean | null = null;
  if (termos.entradaValor != null && termos.entradaValor > 0) {
    const partes = cobrancas.filter((x) => !usadas.has(x.id) && x.tipo === 'entrada').sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    for (const x of partes) usadas.add(x.id);
    const soma = partes.reduce((s, x) => s + x.valorOriginal, 0);
    const pagas = partes.filter((x) => x.classe === 'paga');
    const somaPaga = pagas.reduce((s, x) => s + (x.valorPago ?? x.valorOriginal), 0);
    let situacao: SituacaoLinha;
    if (partes.length === 0) situacao = 'nao_cobrada';
    else if (soma !== termos.entradaValor) situacao = 'valor_diverge';
    else if (pagas.length === partes.length) situacao = 'paga';
    else situacao = partes.some((x) => x.classe === 'vencida') ? 'vencida' : 'pendente';
    linhas.push({
      chave: 'entrada', serie: 'entrada', numero: 0,
      esperadoEm: partes[0]?.vencimento ?? p.primeiraEm, esperadoValor: termos.entradaValor,
      cobrancaId: partes.length === 1 ? partes[0].id : null,
      cobradoEm: partes[0]?.vencimento ?? null,
      cobradoValor: partes.length ? soma : null,
      pagoEm: pagas.length ? pagas[pagas.length - 1].pagoEm : null,
      pagoValor: pagas.length ? somaPaga : null,
      encargo: 0,
      situacao,
      // Entrada sem cobrança no Asaas é comum (paga no ato, fora do boleto): não é divergência.
      divergencia: situacao === 'valor_diverge',
      componentes: null,
      partes: partes.map((x) => ({ cobrancaId: x.id, vencimento: x.vencimento, valor: x.valorOriginal, classe: x.classe })),
      observacao: null,
    });
    entradaPaga = partes.length ? situacao === 'paga' : null;
  }

  // Parcelas semanais
  const valorCobranca = p.valor + termos.seguroSemanal + termos.taxaSemanal;
  const intermediariasCasadas = new Set<number>();
  for (let n = 1; n <= p.quantidade; n++) {
    const data = isoMaisDias(p.primeiraEm, 7 * (n - 1));
    // Intermediária na mesma data? aceita a cobrança combinada.
    const numInter = [...intermediariasPorData.entries()].find(([d]) => Math.abs(difDias(d, data)) <= tol)?.[1];
    const aceitos = [valorCobranca];
    if (numInter && inter?.valor != null) aceitos.push(valorCobranca + inter.valor);
    const c = procurar(['parcela'], data, aceitos, p.valor);
    if (c) usadas.add(c.id);
    let esperado = valorCobranca;
    if (c && numInter && inter?.valor != null && (c.valorOriginal === valorCobranca + inter.valor || c.intermediariaEmbutida > 0)) {
      esperado = valorCobranca + inter.valor;
      intermediariasCasadas.add(numInter);
    }
    // Parcela paga em PARTES (caso real 23/09): a cobrança da semana vale menos
    // que a parcela e outra(s) da mesma semana — inclusive "Acordo semana do
    // dia 26/02" — completam o valor. Só fecha se a soma bate exatamente.
    if (c && c.valorOriginal < esperado && !(c.parcelamento != null && c.parcelamento === p.valor)) {
      const complemento: CobrancaConciliavel[] = [];
      let soma = c.valorOriginal;
      const candidatas = cobrancas
        .filter((x) => !usadas.has(x.id) && (x.tipo === 'parcela' || x.tipo === 'acordo' || x.tipo === 'outra') && Math.abs(difDias(x.vencimento, c.vencimento)) <= tol + 1)
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      for (const x of candidatas) {
        if (soma + x.valorOriginal > esperado) continue;
        complemento.push(x);
        soma += x.valorOriginal;
        if (soma === esperado) break;
      }
      if (soma === esperado && complemento.length) {
        for (const x of complemento) usadas.add(x.id);
        linhas.push(montarComposta('parcela', n, data, esperado, [c, ...complemento], false));
        continue;
      }
    }
    linhas.push(montar('parcela', n, data, esperado, c, p.valor));
  }

  // Segundo passe (caso real 23/09): parcela sem cobrança na semana pode ter
  // sido REEMITIDA com vencimento depois (atraso, juros embutidos). Só aqui —
  // depois de todas as pontuais estarem casadas — uma cobrança de parcela que
  // sobrou, com a mesma parte de parcela e vencimento até 45 dias DEPOIS da
  // data esperada, é aceita para a linha vazia mais antiga.
  for (const linha of linhas) {
    if (linha.serie !== 'parcela' || linha.situacao !== 'nao_cobrada') continue;
    let melhor: CobrancaConciliavel | null = null;
    for (const c of cobrancas) {
      if (usadas.has(c.id) || c.tipo !== 'parcela') continue;
      const dias = difDias(c.vencimento, linha.esperadoEm);
      if (dias <= tol || dias > 45) continue;
      const bate = (c.parcelamento != null && c.parcelamento === p.valor) || c.valorOriginal === linha.esperadoValor;
      if (!bate) continue;
      if (!melhor || c.vencimento < melhor.vencimento) melhor = c;
    }
    if (!melhor) continue;
    usadas.add(melhor.id);
    const nova = montar('parcela', linha.numero, linha.esperadoEm, linha.esperadoValor, melhor, p.valor);
    linhas[linhas.indexOf(linha)] = nova;
  }

  // Intermediárias cobradas à parte
  if (inter?.quantidade && inter.valor != null && inter.primeiraEm) {
    for (let i = 1; i <= inter.quantidade; i++) {
      if (intermediariasCasadas.has(i)) continue;
      const data = isoMaisDias(inter.primeiraEm, 7 * (i - 1));
      const c = procurar(['intermediaria'], data, [inter.valor]);
      if (c) usadas.add(c.id);
      linhas.push(montar('intermediaria', i, data, inter.valor, c));
    }
  }

  // Vínculos manuais: a linha passa a ser composta pelas cobranças que o
  // operador apontou (mais o que a regra já tinha casado nela).
  for (const [chave, ids] of manuais) {
    const idx = linhas.findIndex((l) => l.chave === chave);
    if (idx < 0) continue;
    const linha = linhas[idx];
    const jaNaLinha = linha.partes.length ? linha.partes.map((x) => porId.get(x.cobrancaId)).filter((x): x is CobrancaConciliavel => !!x) : linha.cobrancaId ? [porId.get(linha.cobrancaId)].filter((x): x is CobrancaConciliavel => !!x) : [];
    const apontadas = ids.map((id) => porId.get(id)).filter((x): x is CobrancaConciliavel => !!x);
    if (apontadas.length === 0) continue;
    linhas[idx] = montarComposta(linha.serie, linha.numero, linha.esperadoEm, linha.esperadoValor, [...jaNaLinha, ...apontadas], true);
  }

  // Fora do cronograma
  const fora: ForaDoCronograma[] = params.cobrancas
    .filter((c) => !usadas.has(c.id))
    .map((c) => {
      const semData = c.tipo === 'parcela' || c.tipo === 'intermediaria';
      const motivo =
        c.classe === 'outra' ? 'estornada, apagada ou em disputa'
          : c.tipo === 'acordo' ? 'acordo — parcelas de atraso renegociadas'
            : c.tipo === 'reembolso' ? 'despesa repassada (3.5 do contrato)'
              : c.tipo === 'entrada' ? 'entrada além da prevista nos termos'
                : semData ? 'parcela sem data correspondente no cronograma'
                  : 'sem padrão reconhecido';
      return { cobrancaId: c.id, vencimento: c.vencimento, valorOriginal: c.valorOriginal, tipo: c.tipo, classe: c.classe, descricao: c.descricao, motivo, divergencia: semData && c.classe !== 'outra' };
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const parcelas = linhas.filter((l) => l.serie === 'parcela');
  const cont = (s: SituacaoLinha[]) => parcelas.filter((l) => s.includes(l.situacao)).length;
  const pagas = cont(['paga', 'paga_com_encargo']);
  const interLinhas = linhas.filter((l) => l.serie === 'intermediaria');
  const resumo: ResumoConciliacao = {
    parcelasEsperadas: parcelas.length,
    parcelasPagas: pagas,
    parcelasPendentes: cont(['pendente']),
    parcelasVencidas: cont(['vencida']),
    parcelasNaoCobradas: cont(['nao_cobrada']),
    parcelasFuturas: cont(['futura']),
    intermediariasEsperadas: inter?.quantidade ?? 0,
    intermediariasPagas: intermediariasCasadas.size + interLinhas.filter((l) => l.situacao === 'paga' || l.situacao === 'paga_com_encargo').length,
    entradaPaga,
    encargosPagos: linhas.reduce((s, l) => s + l.encargo, 0),
    saldoContratualRestante: (parcelas.length - pagas) * p.valor,
    divergencias: linhas.filter((l) => l.divergencia).length + fora.filter((f) => f.divergencia).length,
    cobrancasForaDoCronograma: fora.length,
  };
  return { linhas, fora, resumo, incompleta: false };
}
