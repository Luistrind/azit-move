import type { VisaoMensal } from './carteira-visao';

// ------------------------------------------------------------
// A CARTEIRA NO TEMPO (doc 02 §27.11): leituras sobre a série mensal da visão
// da carteira — os pontos do gráfico, o escoamento do que já está contratado
// e a simulação de vendas novas. Tudo em centavos; nada aqui é gravado.
// ------------------------------------------------------------

export type GrupoTempo = 'mes' | 'trimestre';

export interface PontoCarteira {
  chave: string; // 'AAAA-MM' ou 'AAAA-Tn'
  meses: string[]; // meses que o ponto junta
  teto: number;
  pago: number; // faturas do ponto já pagas (valor de face)
  vencido: number;
  aVencer: number;
  recebido: number; // caixa: tudo que entrou nos meses do ponto
  faturas: number;
  clientes: number | null; // só no ponto de um mês (clientes distintos não se somam entre meses)
  porProduto: { chave: string; rotulo: string; teto: number }[];
}

const trimestreDe = (anoMes: string) => `${anoMes.slice(0, 4)}-T${Math.floor((Number(anoMes.slice(5, 7)) - 1) / 3) + 1}`;

// Junta a série mensal em pontos: um por mês, ou um por trimestre civil. `meses`
// é a janela contínua (mês sem fatura entra zerado); os produtos saem na ordem
// em que aparecem na janela, para a cor de cada um não trocar de um ponto a outro.
export function pontosDaCarteira(meses: string[], porMes: Map<string, VisaoMensal>, grupo: GrupoTempo): PontoCarteira[] {
  const ordem: { chave: string; rotulo: string }[] = [];
  for (const m of meses) {
    for (const p of porMes.get(m)?.porProduto ?? []) {
      if (p.teto > 0 && !ordem.some((o) => o.chave === p.chave)) ordem.push({ chave: p.chave, rotulo: p.rotulo });
    }
  }
  const pontos: PontoCarteira[] = [];
  for (const m of meses) {
    const chave = grupo === 'mes' ? m : trimestreDe(m);
    let pt = pontos[pontos.length - 1];
    if (!pt || pt.chave !== chave) {
      pt = { chave, meses: [], teto: 0, pago: 0, vencido: 0, aVencer: 0, recebido: 0, faturas: 0, clientes: null, porProduto: ordem.map((o) => ({ ...o, teto: 0 })) };
      pontos.push(pt);
    }
    pt.meses.push(m);
    const d = porMes.get(m);
    if (!d) continue;
    pt.teto += d.teto.valor;
    pt.pago += d.pagas.valor;
    pt.vencido += d.vencidas.valor;
    pt.aVencer += d.aVencer.valor;
    pt.recebido += d.recebido.valor;
    pt.faturas += d.teto.faturas;
    for (const p of d.porProduto) {
      const alvo = pt.porProduto.find((x) => x.chave === p.chave);
      if (alvo) alvo.teto += p.teto;
    }
  }
  for (const pt of pontos) pt.clientes = pt.meses.length === 1 ? (porMes.get(pt.meses[0])?.teto.clientes ?? 0) : null;
  return pontos;
}

export interface EscoamentoCarteira {
  pico: { mes: string; teto: number };
  limite: number; // 75% do pico
  abaixo: string | null; // primeiro mês DEPOIS do pico com teto abaixo do limite
  ultimo: string; // último mês com fatura
}

// Escoamento do que já está contratado: onde é o pico, quando o teto cai abaixo
// de 75% dele e quando vence a última fatura — "se eu parar de vender hoje".
export function escoamentoDaCarteira(serie: { mes: string; teto: number }[]): EscoamentoCarteira | null {
  const com = serie.filter((x) => x.teto > 0).sort((a, b) => (a.mes < b.mes ? -1 : 1));
  if (!com.length) return null;
  const pico = com.reduce((a, b) => (b.teto > a.teto ? b : a));
  const limite = Math.round(pico.teto * 0.75);
  return { pico: { mes: pico.mes, teto: pico.teto }, limite, abaixo: com.find((x) => x.mes > pico.mes && x.teto < limite)?.mes ?? null, ultimo: com[com.length - 1].mes };
}

// ── Simulação de vendas novas (provisório, Regra 12): só desenha na tela ──
// Um contrato novo vale o que um cliente de hoje tem de fatura por mês, em
// média, e dura `PRAZO_SIMULACAO_MESES`. Substituível quando houver meta e
// premissas de venda salvas como parâmetro.
export const PRAZO_SIMULACAO_MESES = 36;

// Quanto um cliente tem de fatura por mês, em média, nos três próximos meses
// cheios (três meses para alisar o mês de cinco vencimentos).
export function ticketMedioMensal(serie: { mes: string; teto: number; clientes: number }[], mesHoje: string): number {
  const prox = serie.filter((x) => x.mes > mesHoje && x.clientes > 0).sort((a, b) => (a.mes < b.mes ? -1 : 1)).slice(0, 3);
  const clientes = prox.reduce((s, x) => s + x.clientes, 0);
  return clientes ? Math.round(prox.reduce((s, x) => s + x.teto, 0) / clientes) : 0;
}

// Teto a mais em cada mês de `meses` se entrarem `novosPorMes` contratos por
// mês a partir do mês seguinte ao de hoje. No mês j depois de hoje estão
// rodando os contratos vendidos nos últimos `prazoMeses` meses.
export function simularVendasNovas(meses: string[], mesHoje: string, novosPorMes: number, ticketMes: number, prazoMeses: number = PRAZO_SIMULACAO_MESES): number[] {
  const [ah, mh] = mesHoje.split('-').map(Number);
  return meses.map((m) => {
    const [a, mm] = m.split('-').map(Number);
    const j = (a - ah) * 12 + (mm - mh);
    return j <= 0 || novosPorMes <= 0 ? 0 : novosPorMes * Math.min(j, prazoMeses) * ticketMes;
  });
}
