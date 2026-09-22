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
}): ResultadoConciliacao {
  const { termos, hoje } = params;
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

  // Intermediárias por data: quando caem na mesma semana da parcela, o Asaas
  // pode ter cobrado junto (valor = parcela + seguro + taxa + intermediária).
  const inter = termos.intermediarias;
  const intermediariasPorData = new Map<string, number>();
  if (inter?.quantidade && inter.valor != null && inter.primeiraEm) {
    for (let i = 0; i < inter.quantidade; i++) intermediariasPorData.set(isoMaisDias(inter.primeiraEm, 7 * i), i + 1);
  }

  const procurar = (tipos: TipoCobrancaLegada[], data: string, valoresAceitos: number[]) => {
    let melhor: CobrancaConciliavel | null = null;
    let melhorDist = Infinity;
    for (const c of cobrancas) {
      if (usadas.has(c.id) || !tipos.includes(c.tipo)) continue;
      const dist = Math.abs(difDias(c.vencimento, data));
      if (dist > tol) continue;
      const bateValor = valoresAceitos.includes(c.valorOriginal);
      // Prefere quem bate o valor; entre iguais, a data mais próxima.
      const score = dist + (bateValor ? 0 : 100);
      if (score < melhorDist) { melhorDist = score; melhor = c; }
    }
    return melhor;
  };

  const montar = (serie: LinhaConciliacao['serie'], numero: number, esperadoEm: string, esperadoValor: number, c: CobrancaConciliavel | null): LinhaConciliacao => {
    let situacao: SituacaoLinha;
    let encargo = 0;
    if (!c) {
      situacao = esperadoEm > hoje ? 'futura' : 'nao_cobrada';
    } else if (c.valorOriginal !== esperadoValor) {
      situacao = 'valor_diverge';
    } else if (c.classe === 'paga') {
      encargo = c.valorPago != null && c.valorPago > c.valorOriginal ? c.valorPago - c.valorOriginal : 0;
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
    };
  };

  // Entrada no ato
  let entradaPaga: boolean | null = null;
  if (termos.entradaValor != null && termos.entradaValor > 0) {
    const c = procurar(['entrada'], p.primeiraEm, [termos.entradaValor]) ?? cobrancas.find((x) => !usadas.has(x.id) && x.tipo === 'entrada') ?? null;
    if (c) usadas.add(c.id);
    const linha = montar('entrada', 0, c?.vencimento ?? p.primeiraEm, termos.entradaValor, c);
    // Entrada sem cobrança no Asaas é comum (paga no ato, fora do boleto): não é divergência.
    if (!c) { linha.situacao = 'nao_cobrada'; linha.divergencia = false; }
    linhas.push(linha);
    entradaPaga = c ? c.classe === 'paga' : null;
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
    const c = procurar(['parcela'], data, aceitos);
    if (c) usadas.add(c.id);
    let esperado = valorCobranca;
    if (c && numInter && inter?.valor != null && (c.valorOriginal === valorCobranca + inter.valor || c.intermediariaEmbutida > 0)) {
      esperado = valorCobranca + inter.valor;
      intermediariasCasadas.add(numInter);
    }
    linhas.push(montar('parcela', n, data, esperado, c));
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
