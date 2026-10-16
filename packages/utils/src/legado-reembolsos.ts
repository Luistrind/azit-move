// Migração do legado — BACKFILL de Reembolso Parcelado (doc 02 §26.8, 16/10/2026).
//
// Caso real: três contratos já MIGRADOS (Wallace, Robson, Ezequias) tinham
// despesa cobrada junto da parcela (troca de óleo, cota do IPVA, filtro de ar)
// que NÃO virou Reembolso Parcelado na migração — a conciliação declarada ainda
// não aceitava `extra` e, pelas regras, a descrição sem o padrão "A: R$ x" não
// foi lida. O valor da despesa ficou fora do sistema.
//
// Este planejador é PURO: recebe as faturas do contrato migrado (com seus itens,
// a parcela do veículo e a cobrança do Asaas que as prova) e as despesas que o
// operador declara (fatura + valor + rótulo), e descreve o que nasce — a mesma
// estrutura que o planner da migração cria: um ContratoCredito "<numero>-RPk"
// por despesa (consecutivas de mesmo rótulo formam um só RP com N cotas), item
// "Reembolso Parcelado · <rótulo> n/N" na fatura da semana, cotas pagas nascem
// pagas, contrato ENCERRADO por quitação quando tudo pago.
//
// Como a fatura migrada registrou a semana decide o AJUSTE que acompanha o item:
// - folga:     total da fatura já inclui a despesa e os itens somam menos — só
//              entra o item do RP (modo por regras com despesa não lida).
// - principal: itens batem com o total e a cobrança vale o total — o principal
//              do veículo absorveu a despesa; ele diminui e o item do RP entra.
// - faltante:  itens batem com o total MAS a cobrança do Asaas vale total +
//              despesa — a fatura nasceu curta (declaração sem `extra`); total e
//              pago sobem no valor da despesa, com a cobrança como prova.
// Qualquer outra combinação é ERRO: o backfill não adivinha — mostra os números.

import { formatCurrency } from './formatters';

export type ModoAjusteFatura = 'folga' | 'principal' | 'faltante';

export interface ItemFaturaMigrada {
  id: string;
  tipo: string; // PRINCIPAL | SERVICO | ENCARGO | INTERMEDIARIA
  descricao: string;
  valor: number; // centavos
  parcelaId: string | null;
  // Parcela de OUTRO contrato (um RP já criado): numero do contrato dono.
  contratoDaParcela: string | null;
}

export interface FaturaMigrada {
  id: string;
  numero: number;
  vencimento: string; // YYYY-MM-DD
  status: string; // StatusFatura
  valorTotal: number; // centavos
  valorPago: number | null;
  pagoEm: string | null;
  asaasChargeId: string | null;
  // Cobrança do Asaas lida na bancada (prova do que o cliente pagou).
  cobranca: { asaasPaymentId: string; descricao: string | null; valorOriginal: number; valorPago: number | null } | null;
  itens: ItemFaturaMigrada[];
  // Parcela do VEÍCULO que esta fatura cobra.
  parcelaVeiculo: { id: string; numero: number; valorNominal: number; valorPago: number | null } | null;
}

export interface DespesaDeclaradaBackfill {
  faturaId: string;
  valor: number; // centavos
  rotulo: string;
}

export interface AjusteFaturaBackfill {
  faturaId: string;
  numeroFatura: number;
  vencimento: string;
  modo: ModoAjusteFatura;
  valor: number; // a despesa
  totalAntes: number;
  totalDepois: number;
  pagoAntes: number | null;
  pagoDepois: number | null;
  principal: { itemId: string; antes: number; depois: number } | null;
  parcelaVeiculo: { id: string; nominalAntes: number; nominalDepois: number; pagoAntes: number | null; pagoDepois: number | null } | null;
  prova: string; // texto para o operador: o que sustentou a decisão
}

export interface CotaBackfill {
  n: number;
  faturaId: string;
  numeroFatura: number;
  vencimento: string;
  valor: number;
  paga: boolean;
  pagoEm: string | null;
  statusParcela: 'PAGA' | 'PAGA_EM_ATRASO' | null;
  descricaoItem: string;
}

export interface RpBackfill {
  numero: string; // <contrato>-RPk
  rotulo: string;
  total: number;
  numeroParcelas: number;
  status: 'ENCERRADO' | 'ATIVO';
  dataAssinatura: string; // = 1ª cota
  dataEncerramento: string | null; // = última cota, quando tudo pago
  cotas: CotaBackfill[];
}

export interface ProblemaBackfill { faturaId: string; vencimento: string | null; motivo: string }

export interface PlanoReembolsosBackfill {
  rps: RpBackfill[];
  ajustes: AjusteFaturaBackfill[];
  ignoradas: ProblemaBackfill[]; // já existia — nada a fazer (idempotência)
  erros: ProblemaBackfill[]; // inconsistência: não grava enquanto houver
}

// Mesmo saneamento do planner da migração: "(1/5)" e "3/6" saem do rótulo.
export function normalizarRotuloReembolso(rotulo: string | null | undefined): string {
  return (rotulo ?? '').replace(/\s*\(?\d+\s*\/\s*\d+\)?/g, '').trim() || 'Despesa';
}

const reais = (c: number) => formatCurrency(c);
const PAGAS = new Set(['PAGA', 'PAGA_EM_ATRASO']);

// Fatura já tem o item deste RP? (parcela de outro contrato + rótulo igual)
export function faturaJaTemReembolso(f: FaturaMigrada, rotulo: string): boolean {
  const alvo = normalizarRotuloReembolso(rotulo).toLowerCase();
  return f.itens.some((it) => it.contratoDaParcela != null && it.descricao.toLowerCase().startsWith('reembolso parcelado · ') && it.descricao.toLowerCase().includes(` ${alvo} `));
}

function decidirAjuste(f: FaturaMigrada, valor: number): { ok: true; ajuste: AjusteFaturaBackfill } | { ok: false; motivo: string } {
  const somaTodos = f.itens.reduce((s, it) => s + it.valor, 0);
  const somaSemEncargo = f.itens.filter((it) => it.tipo !== 'ENCARGO').reduce((s, it) => s + it.valor, 0);
  const T = f.valorTotal;
  const cob = f.cobranca!;
  const V = cob.valorOriginal;
  const paga = PAGAS.has(f.status);
  const base = { faturaId: f.id, numeroFatura: f.numero, vencimento: f.vencimento, valor };
  const folga = T - somaSemEncargo;

  if (folga === valor) {
    return {
      ok: true,
      ajuste: { ...base, modo: 'folga', totalAntes: T, totalDepois: T, pagoAntes: f.valorPago, pagoDepois: f.valorPago, principal: null, parcelaVeiculo: null, prova: `total da fatura ${reais(T)} já inclui a despesa; itens somam ${reais(somaSemEncargo)} (folga ${reais(folga)}); cobrança ${cob.asaasPaymentId} = ${reais(V)}` },
    };
  }
  if (folga !== 0) {
    return { ok: false, motivo: `itens da fatura somam ${reais(somaSemEncargo)}${somaTodos !== somaSemEncargo ? ` (+ encargo ${reais(somaTodos - somaSemEncargo)})` : ''} e o total é ${reais(T)}: folga de ${reais(folga)} não bate com a despesa de ${reais(valor)}` };
  }
  // Itens batem com o total: ou a cobrança prova que a fatura nasceu curta, ou o principal absorveu.
  if (V === T + valor) {
    if (paga && cob.valorPago != null && f.valorPago != null && cob.valorPago !== f.valorPago + valor) {
      return { ok: false, motivo: `cobrança ${cob.asaasPaymentId} vale ${reais(V)} (= total ${reais(T)} + despesa), mas o pago na cobrança (${reais(cob.valorPago)}) não é o pago na fatura (${reais(f.valorPago)}) + despesa` };
    }
    const pagoDepois = paga && f.valorPago != null ? f.valorPago + valor : f.valorPago;
    return {
      ok: true,
      ajuste: { ...base, modo: 'faltante', totalAntes: T, totalDepois: T + valor, pagoAntes: f.valorPago, pagoDepois, principal: null, parcelaVeiculo: null, prova: `fatura nasceu sem a despesa: total ${reais(T)}, itens ${reais(somaSemEncargo)}; cobrança ${cob.asaasPaymentId} = ${reais(V)} = total + ${reais(valor)}${paga && cob.valorPago != null ? ` (pago ${reais(cob.valorPago)})` : ''}` },
    };
  }
  if (V === T) {
    const pv = f.parcelaVeiculo;
    const principal = pv ? f.itens.find((it) => it.tipo === 'PRINCIPAL' && it.parcelaId === pv.id) : null;
    if (!pv || !principal) return { ok: false, motivo: `cobrança ${cob.asaasPaymentId} vale o total (${reais(T)}) — a despesa estaria dentro do principal, mas a fatura não tem o item principal do veículo` };
    if (principal.valor <= valor) return { ok: false, motivo: `principal do veículo (${reais(principal.valor)}) não comporta a despesa de ${reais(valor)}` };
    const nominalAbsorveu = pv.valorNominal === principal.valor;
    return {
      ok: true,
      ajuste: {
        ...base, modo: 'principal', totalAntes: T, totalDepois: T, pagoAntes: f.valorPago, pagoDepois: f.valorPago,
        principal: { itemId: principal.id, antes: principal.valor, depois: principal.valor - valor },
        parcelaVeiculo: { id: pv.id, nominalAntes: pv.valorNominal, nominalDepois: nominalAbsorveu ? pv.valorNominal - valor : pv.valorNominal, pagoAntes: pv.valorPago, pagoDepois: pv.valorPago != null ? pv.valorPago - valor : null },
        prova: `itens batem com o total ${reais(T)} e a cobrança ${cob.asaasPaymentId} vale o mesmo: o principal do veículo (${reais(principal.valor)}) absorveu a despesa`,
      },
    };
  }
  return { ok: false, motivo: `cobrança ${cob.asaasPaymentId} vale ${reais(V)}; total da fatura ${reais(T)}, itens ${reais(somaSemEncargo)}, despesa ${reais(valor)} — não há leitura consistente` };
}

export function planejarReembolsosFaltantes(params: {
  contratoNumero: string;
  faturas: FaturaMigrada[]; // todas as faturas do contrato migrado (qualquer ordem)
  despesas: DespesaDeclaradaBackfill[];
  rpsExistentes: number; // quantos "<numero>-RPk" já existem — numeração continua
}): PlanoReembolsosBackfill {
  const plano: PlanoReembolsosBackfill = { rps: [], ajustes: [], ignoradas: [], erros: [] };
  const ordenadas = [...params.faturas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero);
  // Sequência do contrato: só faturas que cobram uma parcela do veículo (é nela que a
  // despesa veio junto). "Consecutivas" = vizinhas nesta sequência.
  const sequencia = ordenadas.filter((f) => f.parcelaVeiculo);
  const posicao = new Map(sequencia.map((f, i) => [f.id, i]));
  const porId = new Map(params.faturas.map((f) => [f.id, f]));

  const validas: { f: FaturaMigrada; valor: number; rotulo: string; ajuste: AjusteFaturaBackfill }[] = [];
  const vistas = new Set<string>();
  for (const dsp of params.despesas) {
    const f = porId.get(dsp.faturaId);
    if (!f) { plano.erros.push({ faturaId: dsp.faturaId, vencimento: null, motivo: 'fatura não pertence ao contrato migrado' }); continue; }
    const erro = (motivo: string) => plano.erros.push({ faturaId: f.id, vencimento: f.vencimento, motivo });
    if (vistas.has(f.id)) { erro('a mesma fatura foi informada duas vezes'); continue; }
    vistas.add(f.id);
    const rotulo = normalizarRotuloReembolso(dsp.rotulo);
    if (!dsp.rotulo?.trim()) { erro('informe o rótulo da despesa (ex.: Troca de óleo)'); continue; }
    if (!Number.isInteger(dsp.valor) || dsp.valor <= 0) { erro('valor da despesa deve ser positivo'); continue; }
    if (!f.parcelaVeiculo) { erro('a fatura não cobra uma parcela do veículo'); continue; }
    if (f.status === 'ABERTA') { erro('fatura ainda ABERTA — o sistema emite; lance a despesa pelo produto, não pelo backfill'); continue; }
    if (f.status === 'RENEGOCIADA' || f.status === 'NOVADA') { erro(`fatura ${f.status} — sem cobrança própria`); continue; }
    if (!f.cobranca) { erro('fatura sem cobrança do Asaas vinculada — sem prova do que foi pago'); continue; }
    if (faturaJaTemReembolso(f, rotulo)) { plano.ignoradas.push({ faturaId: f.id, vencimento: f.vencimento, motivo: `já tem o item "Reembolso Parcelado · ${rotulo}" — nada a fazer` }); continue; }
    const d = decidirAjuste(f, dsp.valor);
    if (!d.ok) { erro(d.motivo); continue; }
    validas.push({ f, valor: dsp.valor, rotulo, ajuste: d.ajuste });
  }

  validas.sort((a, b) => posicao.get(a.f.id)! - posicao.get(b.f.id)!);
  let aberto: { chave: string; pos: number; rp: RpBackfill } | null = null;
  for (const v of validas) {
    const pos = posicao.get(v.f.id)!;
    const chave = v.rotulo.toLowerCase();
    if (!aberto || aberto.chave !== chave || aberto.pos + 1 !== pos) {
      const rp: RpBackfill = { numero: `${params.contratoNumero}-RP${params.rpsExistentes + plano.rps.length + 1}`, rotulo: v.rotulo, total: 0, numeroParcelas: 0, status: 'ATIVO', dataAssinatura: v.f.vencimento, dataEncerramento: null, cotas: [] };
      plano.rps.push(rp);
      aberto = { chave, pos, rp };
    }
    aberto.pos = pos;
    const paga = PAGAS.has(v.f.status);
    aberto.rp.cotas.push({ n: aberto.rp.cotas.length + 1, faturaId: v.f.id, numeroFatura: v.f.numero, vencimento: v.f.vencimento, valor: v.valor, paga, pagoEm: paga ? v.f.pagoEm : null, statusParcela: paga ? (v.f.status === 'PAGA_EM_ATRASO' ? 'PAGA_EM_ATRASO' : 'PAGA') : null, descricaoItem: '' });
    plano.ajustes.push(v.ajuste);
  }
  for (const rp of plano.rps) {
    rp.numeroParcelas = rp.cotas.length;
    rp.total = rp.cotas.reduce((s, c) => s + c.valor, 0);
    const tudoPago = rp.cotas.every((c) => c.paga);
    rp.status = tudoPago ? 'ENCERRADO' : 'ATIVO';
    rp.dataEncerramento = tudoPago ? rp.cotas[rp.cotas.length - 1].vencimento : null;
    for (const c of rp.cotas) c.descricaoItem = `Reembolso Parcelado · ${rp.rotulo} ${c.n}/${rp.numeroParcelas}`;
  }
  return plano;
}
