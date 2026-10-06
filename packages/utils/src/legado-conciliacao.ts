// Migração do legado — F2 (doc 02 §26.7): CONCILIAÇÃO do cronograma esperado
// (termos do contrato) com as cobranças reais do Asaas. Puro: recebe termos +
// cobranças já interpretadas, devolve linha a linha o que bate, o que diverge
// e o que ficou fora do cronograma.
//
// Dois modos (doc 02 §26.14, decisão Luís 06/10):
// - SEQUENCIA (padrão): a parcela N do contrato é a N-ésima cobrança de
//   parcela emitida, na ordem. A data é só conferência (cronograma deslocado
//   quando a operação pulou semanas — "carro em manutenção, jogamos pra frente").
// - DATA (legado da bancada): casa por vencimento ±3 dias.
// Em qualquer modo, parcelas de ACORDO ("acordo de uma parcela semanal (k/3)")
// são agrupadas e o grupo propõe quais parcelas antigas ele quitou; o operador
// confirma. Acordo cobre parcela vencida — nunca empurra o cronograma.

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
  // Parcela de ACORDO dentro da cobrança (06/10): valor e "(k/n)" quando escrito.
  acordo?: number;
  acordoRef?: { k: number; n: number } | null;
  descricao: string | null;
}

export interface TermosConciliaveis {
  parcelas: { quantidade: number | null; valor: number | null; primeiraEm: string | null };
  intermediarias: { quantidade: number | null; valor: number | null; primeiraEm: string | null } | null;
  entradaValor: number | null;
  seguroSemanal: number;
  taxaSemanal: number;
}

export type ModoConciliacao = 'SEQUENCIA' | 'DATA';

export type SituacaoLinha =
  | 'paga'
  | 'paga_com_encargo' // pagou depois do vencimento, com juros/multa
  | 'paga_por_acordo' // quitada pelas parcelas de um acordo confirmado
  | 'em_acordo' // coberta por acordo confirmado que ainda não terminou de ser pago
  | 'pendente'
  | 'vencida'
  | 'nao_cobrada' // já deveria ter sido emitida e não há cobrança
  | 'futura' // ainda não chegou a hora de emitir
  | 'valor_diverge'; // há cobrança na data, mas o valor não é o esperado

// Quanto o operador precisa olhar a linha (06/10): alta = casou sem ressalva;
// media = casou com deslocamento, em partes, por vínculo ou por acordo; baixa =
// diverge ou não há cobrança.
export type ConfiancaLinha = 'alta' | 'media' | 'baixa';

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
  confianca: ConfiancaLinha;
  // O que veio JUNTO na cobrança além da parcela do contrato (não é divergência).
  componentes: { seguro: number; taxa: number; intermediaria: number; extra: number; extraRotulo: string | null; acordo: number } | null;
  // Entrada paga em várias transações (23/09): as partes somadas.
  partes: { cobrancaId: string; vencimento: string; valor: number; classe: CobrancaConciliavel['classe'] }[];
  // Cobrança reemitida por atraso (vencimento depois do esperado): explica a data.
  observacao: string | null;
  // Modo SEQUENCIA: quantos dias a cobrança real caiu depois (+) ou antes (−) da data do contrato.
  deslocamentoDias: number | null;
  // Linha quitada por acordo confirmado: id do grupo.
  acordoGrupo: string | null;
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

// Grupo de parcelas de acordo (06/10): as k/n da mesma renegociação, somadas,
// com a proposta do que elas quitam.
export interface GrupoAcordo {
  id: string; // acordo:<id da primeira cobrança>
  rotulo: string;
  parcelas: { cobrancaId: string; vencimento: string; valor: number; k: number | null; n: number | null; classe: CobrancaConciliavel['classe']; pagoEm: string | null; dentroDeParcela: boolean }[];
  total: number; // centavos — soma das parcelas do acordo
  pago: number; // centavos — o que já entrou
  concluido: boolean; // todas pagas
  // Proposta: quantas parcelas do contrato o acordo cobre (pelo valor cheio da
  // cobrança semanal) e o que sobra como juros do acordo.
  proposta: { quantidade: number; juros: number; desconto: number; chaves: string[]; texto: string };
  confirmado: { quantidade: number; chaves: string[] } | null;
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
  // 06/10: o que precisa de olho humano.
  vinculosIgnorados: number; // modo SEQUENCIA: vínculos manuais de parcela que deixaram de valer
  linhasConferir: number; // confiança média
  linhasDecidir: number; // confiança baixa
  acordosSemConfirmar: number;
  deslocamentoSemanas: number; // modo SEQUENCIA: quantas semanas o cronograma real está atrás do contrato
}

export interface ResultadoConciliacao {
  modo: ModoConciliacao;
  linhas: LinhaConciliacao[];
  fora: ForaDoCronograma[];
  acordos: GrupoAcordo[];
  resumo: ResumoConciliacao;
  incompleta: boolean; // termos sem o mínimo (quantidade, valor, 1ª parcela)
}

const DIA_MS = 86_400_000;
const isoMaisDias = (iso: string, dias: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / DIA_MS);
const brl = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const dataBR = (iso: string) => iso.split('-').reverse().join('/');

const RESUMO_VAZIO: ResumoConciliacao = { parcelasEsperadas: 0, parcelasPagas: 0, parcelasPendentes: 0, parcelasVencidas: 0, parcelasNaoCobradas: 0, parcelasFuturas: 0, intermediariasPagas: 0, intermediariasEsperadas: 0, entradaPaga: null, encargosPagos: 0, saldoContratualRestante: 0, divergencias: 0, cobrancasForaDoCronograma: 0, vinculosIgnorados: 0, linhasConferir: 0, linhasDecidir: 0, acordosSemConfirmar: 0, deslocamentoSemanas: 0 };

export function conciliarLegado(params: {
  termos: TermosConciliaveis;
  cobrancas: CobrancaConciliavel[];
  hoje: string; // YYYY-MM-DD
  toleranciaDias?: number;
  modo?: ModoConciliacao;
  // Vínculos MANUAIS (decisão do operador, caso real 23/09): cobrança → linha
  // do cronograma. Acordos e arranjos que regra nenhuma adivinha.
  vinculosManuais?: { cobrancaId: string; chave: string }[];
  // Acordos CONFIRMADOS pelo operador (06/10): grupo → quantas parcelas cobre
  // (modo SEQUENCIA) ou quais (modo DATA).
  acordosConfirmados?: { grupo: string; quantidade: number; chaves?: string[] }[];
}): ResultadoConciliacao {
  const { termos, hoje } = params;
  const modo: ModoConciliacao = params.modo ?? 'SEQUENCIA';
  const vinculosIgnorados = modo === 'SEQUENCIA' ? (params.vinculosManuais ?? []).filter((v) => v.chave.startsWith('parcela:')).length : 0;
  const manuais = new Map<string, string[]>(); // chave → cobrancaIds
  // Vínculo manual de PARCELA é artefato do modo DATA (caso real 06/10: os
  // vínculos antigos prendiam as cobranças compostas e deslocavam tudo). Na
  // SEQUÊNCIA ele é ignorado; entrada/intermediária continuam valendo.
  for (const v of params.vinculosManuais ?? []) {
    if (modo === 'SEQUENCIA' && v.chave.startsWith('parcela:')) continue;
    manuais.set(v.chave, [...(manuais.get(v.chave) ?? []), v.cobrancaId]);
  }
  const confirmados = new Map((params.acordosConfirmados ?? []).map((a) => [a.grupo, a]));
  const tol = params.toleranciaDias ?? 3;
  const p = termos.parcelas;
  if (!p.quantidade || p.valor == null || !p.primeiraEm) {
    return { modo, linhas: [], fora: [], acordos: [], resumo: { ...RESUMO_VAZIO }, incompleta: true };
  }
  const valorParcela = p.valor;
  const primeiraEm = p.primeiraEm;

  const usadas = new Set<string>();
  const cobrancas = params.cobrancas.filter((c) => c.classe !== 'outra');
  const linhas: LinhaConciliacao[] = [];
  const porId = new Map(cobrancas.map((c) => [c.id, c]));
  for (const ids of manuais.values()) for (const id of ids) if (porId.has(id)) usadas.add(id);

  const confiancaDe = (situacao: SituacaoLinha, ressalva: boolean): ConfiancaLinha =>
    situacao === 'valor_diverge' || situacao === 'nao_cobrada' ? 'baixa'
      : ressalva || situacao === 'paga_por_acordo' || situacao === 'em_acordo' ? 'media'
        : 'alta';

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
    const sit: SituacaoLinha = diverge ? 'valor_diverge' : situacao;
    return {
      chave: serie === 'entrada' ? 'entrada' : `${serie}:${numero}`,
      serie, numero, esperadoEm, esperadoValor,
      cobrancaId: ordenadas.length === 1 ? ordenadas[0].id : null,
      cobradoEm: ordenadas[0]?.vencimento ?? null,
      cobradoValor: soma,
      pagoEm: pagas.length ? pagas[pagas.length - 1].pagoEm : null,
      pagoValor: pagas.length ? somaPaga : null,
      encargo,
      situacao: sit,
      divergencia: diverge,
      confianca: confiancaDe(sit, true),
      componentes: null,
      partes: ordenadas.map((x) => ({ cobrancaId: x.id, vencimento: x.vencimento, valor: x.valorOriginal, classe: x.classe })),
      observacao: manual
        ? `vínculo manual (${ordenadas.length} cobrança${ordenadas.length > 1 ? 's' : ''})${soma !== esperadoValor ? ` — soma ${(soma / 100).toFixed(2)} ≠ esperado ${(esperadoValor / 100).toFixed(2)}` : ''}`
        : `paga em ${ordenadas.length} transações`,
      deslocamentoDias: ordenadas[0] ? difDias(ordenadas[0].vencimento, esperadoEm) : null,
      acordoGrupo: null,
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
    const acordoJunto = c?.acordo ?? 0;
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
    const deslocamento = c ? difDias(c.vencimento, esperadoEm) : null;
    const deslocada = deslocamento != null && Math.abs(deslocamento) > tol;
    const observacao = c && deslocada
      ? modo === 'SEQUENCIA'
        ? `cronograma deslocado: cobrada em ${dataBR(c.vencimento)}, ${deslocamento > 0 ? `${Math.round(deslocamento / 7)} semana(s) depois` : `${Math.round(-deslocamento / 7)} semana(s) antes`} da data do contrato`
        : `cobrança reemitida para ${dataBR(c.vencimento)} (atraso)`
      : null;
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
      confianca: confiancaDe(situacao, deslocada || !!(c && (c.extra > 0 || acordoJunto > 0))),
      componentes: c && (c.extra > 0 || c.intermediariaEmbutida > 0 || bateComposicao || acordoJunto > 0)
        ? { seguro: 0, taxa: 0, intermediaria: c.intermediariaEmbutida, extra: c.extra, extraRotulo: c.extraRotulo, acordo: acordoJunto }
        : null,
      partes: [],
      observacao,
      deslocamentoDias: deslocamento,
      acordoGrupo: null,
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
      esperadoEm: partes[0]?.vencimento ?? primeiraEm, esperadoValor: termos.entradaValor,
      cobrancaId: partes.length === 1 ? partes[0].id : null,
      cobradoEm: partes[0]?.vencimento ?? null,
      cobradoValor: partes.length ? soma : null,
      pagoEm: pagas.length ? pagas[pagas.length - 1].pagoEm : null,
      pagoValor: pagas.length ? somaPaga : null,
      encargo: 0,
      situacao,
      // Entrada sem cobrança no Asaas é comum (paga no ato, fora do boleto): não é divergência.
      divergencia: situacao === 'valor_diverge',
      // Entrada sem cobrança não é problema (paga no ato): conferir, não decidir.
      confianca: situacao === 'valor_diverge' ? 'baixa' : situacao === 'nao_cobrada' || partes.length > 1 ? 'media' : 'alta',
      componentes: null,
      partes: partes.map((x) => ({ cobrancaId: x.id, vencimento: x.vencimento, valor: x.valorOriginal, classe: x.classe })),
      observacao: null,
      deslocamentoDias: null,
      acordoGrupo: null,
    });
    entradaPaga = partes.length ? situacao === 'paga' : null;
  }

  // ---------------------------------------------------------------------------
  // Acordos (06/10): agrupa as parcelas de acordo ANTES de casar as parcelas,
  // porque no modo SEQUENCIA um acordo confirmado ocupa números do cronograma.
  // ---------------------------------------------------------------------------
  const valorCobranca = valorParcela + termos.seguroSemanal + termos.taxaSemanal;
  const acordos = agruparAcordos(cobrancas, usadas);
  for (const g of acordos) {
    // Proposta: quantas parcelas cheias cabem no total; o resto é juros do acordo
    // (ou desconto, quando o acordo ficou abaixo de uma parcela).
    const quantidade = Math.max(1, Math.floor(g.total / valorCobranca));
    const juros = Math.max(0, g.total - quantidade * valorCobranca);
    const desconto = Math.max(0, quantidade * valorCobranca - g.total);
    g.proposta = { quantidade, juros, desconto, chaves: [], texto: '' };
    const conf = confirmados.get(g.id);
    if (conf) g.confirmado = { quantidade: conf.quantidade, chaves: conf.chaves ?? [] };
  }
  const acordoConfirmadoPorGrupo = new Map(acordos.filter((g) => g.confirmado).map((g) => [g.id, g]));
  // Parcela de acordo AVULSA é consumida pelo grupo; a embutida numa cobrança de
  // parcela continua sendo a parcela da semana (só o pedaço de acordo é do grupo).
  for (const g of acordoConfirmadoPorGrupo.values()) for (const x of g.parcelas) if (!x.dentroDeParcela) usadas.add(x.cobrancaId);

  // Linha quitada por acordo: principal = valor cheio da cobrança semanal; juros
  // do acordo viram ENCARGO (decisão 02/10: juros não são valor pago).
  const montarPorAcordo = (numero: number, esperadoEm: string, g: GrupoAcordo, indice: number, quantidade: number): LinhaConciliacao => {
    const ordenadas = [...g.parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const pagas = ordenadas.filter((x) => x.classe === 'paga');
    const jurosTotal = Math.max(0, g.total - quantidade * valorCobranca);
    const descontoTotal = Math.max(0, quantidade * valorCobranca - g.total);
    // Juros/desconto rateados por parcela coberta; a última leva o resto.
    const rateio = (total: number) => (indice === quantidade - 1 ? total - Math.floor(total / quantidade) * (quantidade - 1) : Math.floor(total / quantidade));
    const juros = rateio(jurosTotal);
    const desconto = rateio(descontoTotal);
    const situacao: SituacaoLinha = g.concluido ? 'paga_por_acordo' : 'em_acordo';
    return {
      chave: `parcela:${numero}`, serie: 'parcela', numero, esperadoEm,
      esperadoValor: valorCobranca,
      cobrancaId: null,
      cobradoEm: ordenadas[0]?.vencimento ?? null,
      cobradoValor: valorCobranca - desconto,
      pagoEm: g.concluido && pagas.length ? pagas[pagas.length - 1].pagoEm : null,
      pagoValor: g.concluido ? valorCobranca - desconto : null,
      encargo: g.concluido ? juros : 0,
      situacao,
      divergencia: false,
      confianca: 'media',
      componentes: null,
      partes: ordenadas.map((x) => ({ cobrancaId: x.cobrancaId, vencimento: x.vencimento, valor: x.valor, classe: x.classe })),
      observacao: `${g.rotulo}: ${ordenadas.length} parcela(s) de acordo, total R$ ${brl(g.total)} — cobre ${quantidade} parcela(s) do contrato${jurosTotal ? `, juros do acordo R$ ${brl(jurosTotal)}` : ''}${descontoTotal ? `, desconto R$ ${brl(descontoTotal)}` : ''}${g.concluido ? '' : ' (acordo ainda em pagamento)'}`,
      deslocamentoDias: null,
      acordoGrupo: g.id,
    };
  };

  // ---------------------------------------------------------------------------
  // Parcelas semanais
  // ---------------------------------------------------------------------------
  const intermediariasCasadas = new Set<number>();
  const aceitosPara = (data: string) => {
    const numInter = [...intermediariasPorData.entries()].find(([d]) => Math.abs(difDias(d, data)) <= tol)?.[1];
    const aceitos = [valorCobranca];
    if (numInter && inter?.valor != null) aceitos.push(valorCobranca + inter.valor);
    return { numInter, aceitos };
  };
  const esperadoCom = (c: CobrancaConciliavel | null, numInter: number | undefined) => {
    let esperado = valorCobranca;
    if (c && numInter && inter?.valor != null && (c.valorOriginal === valorCobranca + inter.valor || c.intermediariaEmbutida > 0)) {
      esperado = valorCobranca + inter.valor;
      intermediariasCasadas.add(numInter);
    }
    return esperado;
  };
  // Parcela paga em PARTES (caso real 23/09): a cobrança vale menos que a
  // parcela e outra(s) da mesma semana completam. Só fecha se a soma bate.
  const completarEmPartes = (c: CobrancaConciliavel, esperado: number): CobrancaConciliavel[] | null => {
    if (!(c.valorOriginal < esperado && !(c.parcelamento != null && c.parcelamento === valorParcela))) return null;
    const complemento: CobrancaConciliavel[] = [];
    let soma = c.valorOriginal;
    const candidatas = cobrancas
      .filter((x) => !usadas.has(x.id) && x.id !== c.id && (x.tipo === 'parcela' || x.tipo === 'acordo' || x.tipo === 'outra') && Math.abs(difDias(x.vencimento, c.vencimento)) <= tol + 1)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    for (const x of candidatas) {
      if (soma + x.valorOriginal > esperado) continue;
      complemento.push(x);
      soma += x.valorOriginal;
      if (soma === esperado) break;
    }
    return soma === esperado && complemento.length ? complemento : null;
  };

  if (modo === 'DATA') {
    for (let n = 1; n <= p.quantidade; n++) {
      const data = isoMaisDias(primeiraEm, 7 * (n - 1));
      const { numInter, aceitos } = aceitosPara(data);
      const c = procurar(['parcela'], data, aceitos, valorParcela);
      if (c) usadas.add(c.id);
      const esperado = esperadoCom(c, numInter);
      if (c) {
        const complemento = completarEmPartes(c, esperado);
        if (complemento) {
          for (const x of complemento) usadas.add(x.id);
          linhas.push(montarComposta('parcela', n, data, esperado, [c, ...complemento], false));
          continue;
        }
      }
      linhas.push(montar('parcela', n, data, esperado, c, valorParcela));
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
        const bate = (c.parcelamento != null && c.parcelamento === valorParcela) || c.valorOriginal === linha.esperadoValor;
        if (!bate) continue;
        if (!melhor || c.vencimento < melhor.vencimento) melhor = c;
      }
      if (!melhor) continue;
      usadas.add(melhor.id);
      linhas[linhas.indexOf(linha)] = montar('parcela', linha.numero, linha.esperadoEm, linha.esperadoValor, melhor, valorParcela);
    }

    // Acordos confirmados no modo DATA: as chaves escolhidas viram "paga por acordo".
    for (const g of acordoConfirmadoPorGrupo.values()) {
      const chaves = g.confirmado!.chaves.length ? g.confirmado!.chaves : proporChaves(linhas, g, g.confirmado!.quantidade);
      chaves.forEach((chave, i) => {
        const idx = linhas.findIndex((l) => l.chave === chave);
        if (idx < 0) return;
        linhas[idx] = montarPorAcordo(linhas[idx].numero, linhas[idx].esperadoEm, g, i, chaves.length);
      });
    }
  } else {
    // SEQUENCIA: unidades de parcela na ordem real de emissão. Uma unidade é uma
    // cobrança de parcela (ou cobrança + complementos da mesma semana); um
    // acordo confirmado vale `quantidade` unidades, posicionadas na data da sua
    // primeira parcela — logo antes da semana em que começou a ser cobrado.
    type Unidade = { data: string; partes: CobrancaConciliavel[]; acordo: { g: GrupoAcordo; indice: number; quantidade: number } | null };
    const unidades: Unidade[] = [];
    const candidatas = cobrancas.filter((c) => !usadas.has(c.id) && c.tipo === 'parcela').sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id.localeCompare(b.id));
    for (const c of candidatas) {
      if (usadas.has(c.id)) continue;
      usadas.add(c.id);
      const { numInter } = aceitosPara(c.vencimento);
      const esperado = esperadoCom(c, numInter);
      const complemento = completarEmPartes(c, esperado);
      if (complemento) for (const x of complemento) usadas.add(x.id);
      unidades.push({ data: c.vencimento, partes: complemento ? [c, ...complemento] : [c], acordo: null });
    }
    for (const g of acordoConfirmadoPorGrupo.values()) {
      const quantidade = g.confirmado!.quantidade;
      const primeira = [...g.parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
      // Um minuto antes da cobrança composta da mesma data: ordena antes dela.
      const data = primeira ? isoMaisDias(primeira.vencimento, -1) : primeiraEm;
      for (let i = 0; i < quantidade; i++) unidades.push({ data, partes: [], acordo: { g, indice: i, quantidade } });
    }
    unidades.sort((a, b) => a.data.localeCompare(b.data));

    let n = 0;
    for (const u of unidades) {
      n += 1;
      if (n > p.quantidade) break;
      const dataContrato = isoMaisDias(primeiraEm, 7 * (n - 1));
      if (u.acordo) { linhas.push(montarPorAcordo(n, dataContrato, u.acordo.g, u.acordo.indice, u.acordo.quantidade)); continue; }
      const c = u.partes[0];
      const { numInter } = aceitosPara(c.vencimento);
      const esperado = esperadoCom(c, numInter);
      if (u.partes.length > 1) {
        const l = montarComposta('parcela', n, dataContrato, esperado, u.partes, false);
        linhas.push(l);
      } else {
        linhas.push(montar('parcela', n, dataContrato, esperado, c, valorParcela));
      }
    }
    // Cobranças de parcela além da quantidade do contrato ficam fora (sobram em `usadas`? não: devolve).
    for (const u of unidades.slice(p.quantidade)) for (const x of u.partes) usadas.delete(x.id);

    // O que falta: segue semanalmente a partir da ÚLTIMA cobrança real (o
    // cronograma deslocou junto com a operação). Sem cobrança nenhuma, do contrato.
    const ultima = unidades.length ? unidades[Math.min(unidades.length, p.quantidade) - 1] : null;
    const ultimaData = ultima ? (ultima.partes[0]?.vencimento ?? isoMaisDias(ultima.data, 1)) : isoMaisDias(primeiraEm, -7);
    const emitidas = Math.min(unidades.length, p.quantidade);
    for (let k = emitidas + 1; k <= p.quantidade; k++) {
      const data = isoMaisDias(ultimaData, 7 * (k - emitidas));
      const l = montar('parcela', k, data, valorCobranca, null, valorParcela);
      // Depois da última emitida, semana sem cobrança é só "ainda não emitida".
      if (l.situacao === 'nao_cobrada') { l.situacao = 'futura'; l.divergencia = false; l.confianca = 'alta'; }
      linhas.push(l);
    }
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
    if (linha.acordoGrupo) continue;
    const jaNaLinha = linha.partes.length ? linha.partes.map((x) => porId.get(x.cobrancaId)).filter((x): x is CobrancaConciliavel => !!x) : linha.cobrancaId ? [porId.get(linha.cobrancaId)].filter((x): x is CobrancaConciliavel => !!x) : [];
    const apontadas = ids.map((id) => porId.get(id)).filter((x): x is CobrancaConciliavel => !!x);
    if (apontadas.length === 0) continue;
    linhas[idx] = montarComposta(linha.serie, linha.numero, linha.esperadoEm, linha.esperadoValor, [...jaNaLinha, ...apontadas], true);
  }

  // Propostas dos acordos ainda não confirmados: quais linhas eles quitariam.
  const ordem = (l: LinhaConciliacao) => (l.serie === 'entrada' ? -1 : l.numero);
  linhas.sort((a, b) => (a.serie === b.serie ? ordem(a) - ordem(b) : a.serie === 'entrada' ? -1 : b.serie === 'entrada' ? 1 : a.serie === 'parcela' ? -1 : 1));
  for (const g of acordos) {
    const q = g.proposta.quantidade;
    if (modo === 'DATA') {
      g.proposta.chaves = proporChaves(linhas, g, q);
      const nums = g.proposta.chaves.map((c) => c.split(':')[1]).join(', ');
      g.proposta.texto = `${g.parcelas.length} parcela(s) de acordo somam R$ ${brl(g.total)} — cobre ${q} parcela(s) de R$ ${brl(valorCobranca)}${nums ? ` (parcela${q > 1 ? 's' : ''} ${nums}, as mais antigas sem pagamento antes do acordo)` : ' (nenhuma parcela em aberto antes do acordo — escolha na confirmação)'}${g.proposta.juros ? `; R$ ${brl(g.proposta.juros)} são juros do acordo` : ''}${g.proposta.desconto ? `; R$ ${brl(g.proposta.desconto)} de desconto` : ''}`;
    } else {
      const primeira = [...g.parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
      const antes = linhas.filter((l) => l.serie === 'parcela' && l.cobradoEm && primeira && l.cobradoEm < primeira.vencimento).length;
      g.proposta.texto = `${g.parcelas.length} parcela(s) de acordo somam R$ ${brl(g.total)} — cobre ${q} parcela(s) de R$ ${brl(valorCobranca)}, que entram no cronograma como parcela${q > 1 ? 's' : ''} ${Array.from({ length: q }, (_, i) => antes + 1 + i).join(' e ')} (logo antes da semana em que o acordo começou a ser cobrado)${g.proposta.juros ? `; R$ ${brl(g.proposta.juros)} são juros do acordo` : ''}${g.proposta.desconto ? `; R$ ${brl(g.proposta.desconto)} de desconto` : ''}`;
    }
  }

  // Fora do cronograma
  const fora: ForaDoCronograma[] = params.cobrancas
    .filter((c) => !usadas.has(c.id))
    .map((c) => {
      const semData = c.tipo === 'parcela' || c.tipo === 'intermediaria';
      const motivo =
        c.classe === 'outra' ? 'estornada, apagada ou em disputa'
          : c.tipo === 'acordo' ? 'acordo — confirme no quadro de acordos o que ele cobre'
            : c.tipo === 'reembolso' ? 'despesa repassada (3.5 do contrato)'
              : c.tipo === 'entrada' ? 'entrada além da prevista nos termos'
                : semData ? (modo === 'SEQUENCIA' ? 'parcela além da quantidade do contrato' : 'parcela sem data correspondente no cronograma')
                  : 'sem padrão reconhecido';
      return { cobrancaId: c.id, vencimento: c.vencimento, valorOriginal: c.valorOriginal, tipo: c.tipo, classe: c.classe, descricao: c.descricao, motivo, divergencia: semData && c.classe !== 'outra' };
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const parcelas = linhas.filter((l) => l.serie === 'parcela');
  const cont = (s: SituacaoLinha[]) => parcelas.filter((l) => s.includes(l.situacao)).length;
  const pagas = cont(['paga', 'paga_com_encargo', 'paga_por_acordo']);
  const interLinhas = linhas.filter((l) => l.serie === 'intermediaria');
  const ultimaCobrada = [...parcelas].reverse().find((l) => l.cobradoEm && l.deslocamentoDias != null);
  const resumo: ResumoConciliacao = {
    parcelasEsperadas: parcelas.length,
    parcelasPagas: pagas,
    parcelasPendentes: cont(['pendente', 'em_acordo']),
    parcelasVencidas: cont(['vencida']),
    parcelasNaoCobradas: cont(['nao_cobrada']),
    parcelasFuturas: cont(['futura']),
    intermediariasEsperadas: inter?.quantidade ?? 0,
    intermediariasPagas: intermediariasCasadas.size + interLinhas.filter((l) => l.situacao === 'paga' || l.situacao === 'paga_com_encargo').length,
    entradaPaga,
    encargosPagos: linhas.reduce((s, l) => s + l.encargo, 0),
    saldoContratualRestante: (parcelas.length - pagas) * valorParcela,
    divergencias: linhas.filter((l) => l.divergencia).length + fora.filter((f) => f.divergencia).length,
    cobrancasForaDoCronograma: fora.length,
    vinculosIgnorados,
    linhasConferir: linhas.filter((l) => l.confianca === 'media').length,
    linhasDecidir: linhas.filter((l) => l.confianca === 'baixa').length,
    acordosSemConfirmar: acordos.filter((g) => !g.confirmado).length,
    deslocamentoSemanas: modo === 'SEQUENCIA' && ultimaCobrada?.deslocamentoDias != null ? Math.round(ultimaCobrada.deslocamentoDias / 7) : 0,
  };
  return { modo, linhas, fora, acordos, resumo, incompleta: false };
}

// Agrupa parcelas de acordo (06/10): as "(k/n)" de uma mesma sequência formam
// um grupo; sem "(k/n)", cada cobrança de acordo é um grupo próprio. Parcela
// de acordo embutida numa cobrança de parcela entra pelo seu pedaço.
function agruparAcordos(cobrancas: CobrancaConciliavel[], usadas: Set<string>): GrupoAcordo[] {
  type Item = GrupoAcordo['parcelas'][number] & { rotulo: string };
  const itens: Item[] = [];
  for (const c of cobrancas) {
    if (usadas.has(c.id)) continue;
    const valor = c.tipo === 'acordo' ? c.valorOriginal : (c.acordo ?? 0);
    if (valor <= 0) continue;
    itens.push({
      cobrancaId: c.id, vencimento: c.vencimento, valor,
      k: c.acordoRef?.k ?? null, n: c.acordoRef?.n ?? null,
      classe: c.classe, pagoEm: c.pagoEm,
      dentroDeParcela: c.tipo !== 'acordo',
      rotulo: rotuloAcordo(c.descricao),
    });
  }
  itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || (a.k ?? 0) - (b.k ?? 0));
  const grupos: GrupoAcordo[] = [];
  let aberto: GrupoAcordo | null = null;
  for (const it of itens) {
    const continua = aberto && it.n != null && aberto.parcelas[0].n === it.n && it.k != null && it.k === (aberto.parcelas[aberto.parcelas.length - 1].k ?? 0) + 1;
    if (!continua) {
      aberto = { id: `acordo:${it.cobrancaId}`, rotulo: it.rotulo, parcelas: [], total: 0, pago: 0, concluido: false, proposta: { quantidade: 1, juros: 0, desconto: 0, chaves: [], texto: '' }, confirmado: null };
      grupos.push(aberto);
    }
    aberto!.parcelas.push({ cobrancaId: it.cobrancaId, vencimento: it.vencimento, valor: it.valor, k: it.k, n: it.n, classe: it.classe, pagoEm: it.pagoEm, dentroDeParcela: it.dentroDeParcela });
  }
  for (const g of grupos) {
    g.total = g.parcelas.reduce((s, x) => s + x.valor, 0);
    g.pago = g.parcelas.filter((x) => x.classe === 'paga').reduce((s, x) => s + x.valor, 0);
    g.concluido = g.parcelas.every((x) => x.classe === 'paga');
    const n = g.parcelas[0].n;
    if (n != null && g.parcelas.length < n) g.rotulo += ` (${g.parcelas.length} de ${n} cobradas até agora)`;
  }
  return grupos;
}

function rotuloAcordo(descricao: string | null): string {
  const d = (descricao ?? '').split(/\s*\/\/\s*|\s+\/\s+|(?<=\d,\d{2})\/\s+/).find((s) => /acordo|renegoc/i.test(s)) ?? descricao ?? 'Acordo';
  return d.replace(/R?\$\s*[\d.,]+/g, '').replace(/\(?\s*\d+\s*(?:\/|de)\s*\d+\s*\)?\s*$/, '').replace(/[\s\-–:]+$/, '').trim() || 'Acordo';
}

// Modo DATA: as linhas mais antigas sem pagamento ANTES de o acordo começar.
function proporChaves(linhas: LinhaConciliacao[], g: GrupoAcordo, quantidade: number): string[] {
  const primeira = [...g.parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
  if (!primeira) return [];
  return linhas
    .filter((l) => l.serie === 'parcela' && (l.situacao === 'nao_cobrada' || l.situacao === 'vencida') && l.esperadoEm < primeira.vencimento && !l.acordoGrupo)
    .sort((a, b) => a.numero - b.numero)
    .slice(0, quantidade)
    .map((l) => l.chave);
}
