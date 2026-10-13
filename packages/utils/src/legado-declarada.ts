// Migração do legado — CONCILIAÇÃO DECLARADA (doc 02 §26.15, decisão Luís
// 13/10/2026): quando as regras da bancada não dão conta do histórico de um
// cliente, o cronograma é validado caso a caso (Luís + Claude, a partir da
// exportação do Asaas e do PDF) e DECLARADO parcela a parcela. A F3 migra a
// partir dele exatamente como migra a partir da conciliação por regras. Puro:
// expande a declaração compacta no mesmo ResultadoConciliacao do motor.

import type { CobrancaConciliavel, ForaDoCronograma, LinhaConciliacao, ResultadoConciliacao, ResumoConciliacao, SituacaoLinha, TermosConciliaveis } from './legado-conciliacao';

export type SituacaoDeclarada = 'paga' | 'paga_com_encargo' | 'paga_por_acordo' | 'vencida' | 'pendente' | 'nao_cobrada' | 'adiada' | 'futura';

export interface ParcelaDeclarada {
  numero: number;
  vencimento: string; // YYYY-MM-DD — data que a parcela recebe no contrato migrado
  situacao: SituacaoDeclarada;
  cobrancas?: string[]; // ids de cobrança do Asaas (pay_…) que pagaram/cobram esta parcela — prova
  pagoEm?: string | null;
  pagoValor?: number | null; // centavos — o que entrou de principal (sem juros); default = valor da parcela
  encargo?: number | null; // centavos — juros/multa pagos (não abatem saldo)
  valor?: number | null; // centavos — valor de face da parcela; default = parcela + seguro + taxa dos termos
  observacao?: string | null;
}

export interface DeclaracaoConciliacao {
  observacao?: string | null;
  entrada?: { valor: number; pagoEm?: string | null; cobrancas?: string[] } | null;
  parcelas: ParcelaDeclarada[];
  intermediarias?: ParcelaDeclarada[];
  // Cobranças avulsas que viram fatura própria na migração (desfecho COBRANCA_AVULSA).
  fora?: { cobranca: string; nota?: string | null }[];
}

export interface ReconhecimentoSintetizado { chave: string; desfecho: 'ADIADA' | 'COBRANCA_AVULSA' | 'PAGA_FORA_ASAAS'; nota: string }

export function expandirConciliacaoDeclarada(params: {
  declaracao: DeclaracaoConciliacao;
  termos: TermosConciliaveis;
  cobrancas: CobrancaConciliavel[]; // id = id interno; asaasPaymentId por `asaasIdDe`
  asaasIdDe: (cobrancaId: string) => string | null;
  hoje: string;
}): ResultadoConciliacao & { reconhecimentos: ReconhecimentoSintetizado[] } {
  const { declaracao: d, termos, hoje } = params;
  const porAsaas = new Map<string, CobrancaConciliavel>();
  for (const c of params.cobrancas) {
    const a = params.asaasIdDe(c.id);
    if (a) porAsaas.set(a, c);
  }
  const usadas = new Set<string>();
  const reconhecimentos: ReconhecimentoSintetizado[] = [];
  const valorCobranca = (termos.parcelas.valor ?? 0) + termos.seguroSemanal + termos.taxaSemanal;

  const partesDe = (ids: string[] | undefined) => {
    const partes: CobrancaConciliavel[] = [];
    for (const a of ids ?? []) {
      const c = porAsaas.get(a);
      if (c) { partes.push(c); usadas.add(c.id); }
    }
    return partes.sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  };

  const linha = (serie: LinhaConciliacao['serie'], p: ParcelaDeclarada, esperadoPadrao: number): LinhaConciliacao => {
    const partes = partesDe(p.cobrancas);
    const esperadoValor = p.valor ?? esperadoPadrao;
    let situacao: SituacaoLinha;
    if (p.situacao === 'adiada') situacao = 'nao_cobrada';
    else if (p.situacao === 'futura') situacao = p.vencimento > hoje ? 'futura' : 'pendente';
    else situacao = p.situacao;
    const paga = situacao === 'paga' || situacao === 'paga_com_encargo' || situacao === 'paga_por_acordo';
    const pagas = partes.filter((x) => x.classe === 'paga');
    const encargo = Math.max(0, p.encargo ?? 0);
    if (paga && encargo > 0 && situacao === 'paga') situacao = 'paga_com_encargo';
    const pagoValor = paga ? (p.pagoValor ?? esperadoValor) : null;
    const chave = serie === 'entrada' ? 'entrada' : `${serie}:${p.numero}`;
    if (p.situacao === 'adiada') reconhecimentos.push({ chave, desfecho: 'ADIADA', nota: p.observacao ?? 'adiada (declarada)' });
    if (paga && partes.length === 0 && situacao !== 'paga_por_acordo') reconhecimentos.push({ chave, desfecho: 'PAGA_FORA_ASAAS', nota: p.observacao ?? 'paga fora do Asaas (declarada)' });
    return {
      chave, serie, numero: p.numero,
      esperadoEm: p.vencimento,
      esperadoValor,
      cobrancaId: partes.length === 1 ? partes[0].id : null,
      cobradoEm: partes[0]?.vencimento ?? (paga ? p.vencimento : null),
      // Fatura migrada = a parcela cheia; as cobranças ficam como prova nas partes.
      cobradoValor: partes.length || paga ? esperadoValor : null,
      pagoEm: paga ? (p.pagoEm ?? pagas[pagas.length - 1]?.pagoEm ?? p.vencimento) : null,
      // Paga/paga com encargo: o que entrou (principal + juros), como o Asaas registra;
      // paga por acordo: só o principal — a migração soma o encargo por fora.
      pagoValor: pagoValor == null ? null : situacao === 'paga_por_acordo' ? pagoValor : pagoValor + encargo,
      encargo,
      situacao,
      divergencia: false,
      confianca: 'alta',
      componentes: null,
      partes: partes.map((x) => ({ cobrancaId: x.id, vencimento: x.vencimento, valor: x.valorOriginal, classe: x.classe })),
      observacao: p.observacao ?? null,
      deslocamentoDias: null,
      acordoGrupo: situacao === 'paga_por_acordo' ? 'declarado' : null,
    };
  };

  const linhas: LinhaConciliacao[] = [];
  let entradaPaga: boolean | null = null;
  if (d.entrada && d.entrada.valor > 0) {
    const partes = partesDe(d.entrada.cobrancas);
    linhas.push({
      chave: 'entrada', serie: 'entrada', numero: 0,
      esperadoEm: d.entrada.pagoEm ?? partes[0]?.vencimento ?? d.parcelas[0]?.vencimento ?? hoje,
      esperadoValor: d.entrada.valor,
      cobrancaId: partes.length === 1 ? partes[0].id : null,
      cobradoEm: partes[0]?.vencimento ?? null,
      cobradoValor: d.entrada.valor,
      pagoEm: d.entrada.pagoEm ?? partes[0]?.pagoEm ?? null,
      pagoValor: d.entrada.valor,
      encargo: 0, situacao: 'paga', divergencia: false, confianca: 'alta', componentes: null,
      partes: partes.map((x) => ({ cobrancaId: x.id, vencimento: x.vencimento, valor: x.valorOriginal, classe: x.classe })),
      observacao: null, deslocamentoDias: null, acordoGrupo: null,
    });
    if (partes.length === 0) reconhecimentos.push({ chave: 'entrada', desfecho: 'PAGA_FORA_ASAAS', nota: 'entrada paga fora do Asaas (declarada)' });
    entradaPaga = true;
  }
  for (const p of [...d.parcelas].sort((a, b) => a.numero - b.numero)) linhas.push(linha('parcela', p, valorCobranca));
  const interValor = termos.intermediarias?.valor ?? 0;
  for (const p of [...(d.intermediarias ?? [])].sort((a, b) => a.numero - b.numero)) linhas.push(linha('intermediaria', p, interValor));

  // Fora: só o que foi declarado vira fatura avulsa; o resto é ignorado na migração.
  const fora: ForaDoCronograma[] = [];
  for (const f of d.fora ?? []) {
    const c = porAsaas.get(f.cobranca);
    if (!c) continue;
    usadas.add(c.id);
    fora.push({ cobrancaId: c.id, vencimento: c.vencimento, valorOriginal: c.valorOriginal, tipo: c.tipo, classe: c.classe, descricao: c.descricao, motivo: f.nota ?? 'cobrança avulsa (declarada)', divergencia: false });
    reconhecimentos.push({ chave: `cobranca:${c.id}`, desfecho: 'COBRANCA_AVULSA', nota: f.nota ?? 'declarada' });
  }
  for (const c of params.cobrancas) {
    if (usadas.has(c.id)) continue;
    fora.push({ cobrancaId: c.id, vencimento: c.vencimento, valorOriginal: c.valorOriginal, tipo: c.tipo, classe: 'outra', descricao: c.descricao, motivo: 'não declarada — fica como prova, não vira fatura', divergencia: false });
  }
  fora.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const parcelas = linhas.filter((l) => l.serie === 'parcela');
  const cont = (s: SituacaoLinha[]) => parcelas.filter((l) => s.includes(l.situacao)).length;
  const pagas = cont(['paga', 'paga_com_encargo', 'paga_por_acordo']);
  const inter = linhas.filter((l) => l.serie === 'intermediaria');
  const resumo: ResumoConciliacao = {
    parcelasEsperadas: parcelas.length,
    parcelasPagas: pagas,
    parcelasPendentes: cont(['pendente']),
    parcelasVencidas: cont(['vencida']),
    parcelasNaoCobradas: cont(['nao_cobrada']),
    parcelasFuturas: cont(['futura']),
    intermediariasEsperadas: inter.length,
    intermediariasPagas: inter.filter((l) => l.situacao === 'paga' || l.situacao === 'paga_com_encargo').length,
    entradaPaga,
    encargosPagos: linhas.reduce((s, l) => s + l.encargo, 0),
    saldoContratualRestante: (parcelas.length - pagas) * (termos.parcelas.valor ?? 0),
    divergencias: 0,
    cobrancasForaDoCronograma: fora.filter((f) => f.classe !== 'outra').length,
    vinculosIgnorados: 0,
    linhasConferir: 0,
    linhasDecidir: 0,
    acordosSemConfirmar: 0,
    deslocamentoSemanas: 0,
  };
  return { modo: 'DECLARADA', linhas, fora, acordos: [], resumo, incompleta: false, reconhecimentos };
}
