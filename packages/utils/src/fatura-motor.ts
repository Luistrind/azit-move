// ============================================================
// MOTOR DA FATURA AZIT (doc 02 §32.4, §32.4-A, §32.5, §32.6, §32.6-A).
// Funções PURAS, em CENTAVOS INTEIROS e datas 'YYYY-MM-DD' (dia do Brasil,
// Regra 15). É a ÚNICA conta de encargo, cascata, baixa pela conta e mínimo
// do parcial do modelo AZIT (Regra 16): página pública, baixa do webhook e
// ficha do titular chamam daqui. Referência executável: o bloco
// <script id="motor"> de docs/prototipos/fatura-azit-v3.html, com os números
// conferidos pelo Vicente (14/11).
//
// Nada aqui é estado gravado (Regra 7): multa lançada, encargo pendente e
// "desde quando conta a atualização" saem de REFAZER a conta sobre os itens da
// fatura e os pagamentos registrados (`reconstituirFatura`).
// ============================================================
import { detalharEncargoAtraso } from './calculations';
import { diasCalendarioEntre } from './datas';
import { imputarEmNiveis } from './imputacao';
import type { AlocacaoMotor, AlvoAlocacao, FaturaMotor, GrupoCascata, ItemMotor, PagamentoMotor, ParametrosMotorFatura } from '@azit/types';

// Os tipos de ENTRADA do motor moram em @azit/types (trafegam do backend para a
// página pública); reexportados aqui para quem só importa o motor.
export type { AlocacaoMotor, AlvoAlocacao, FaturaMotor, GrupoCascata, ItemMotor, PagamentoMotor, ParametrosMotorFatura };

// Grupos da cascata de baixa (FAT003). A ORDEM é parâmetro (lista), nunca `if`.
export const GRUPOS_CASCATA = ['ENCARGOS', 'PROTECAO', 'ACESSORIOS', 'PRINCIPAL'] as const satisfies readonly GrupoCascata[];
export const CASCATA_PADRAO: GrupoCascata[] = ['ENCARGOS', 'PROTECAO', 'ACESSORIOS', 'PRINCIPAL'];
export const ROTULO_GRUPO_CASCATA: Record<GrupoCascata, string> = {
  ENCARGOS: 'Encargos (multa e atualização)',
  PROTECAO: 'Proteção veicular',
  ACESSORIOS: 'Acessórios (acordo, Reembolso Parcelado, outros serviços)',
  PRINCIPAL: 'Principal (parcela do veículo, intermediária)',
};

// Parâmetros de faturamento que o motor consome (Configurações › Faturamento).
export const PARAMETROS_MOTOR_PADRAO: ParametrosMotorFatura = {
  cascata: CASCATA_PADRAO,
  minimoParcialPct: 35,
  minimoParcialPiso: 20000,
};

// Cascata válida = cada grupo exatamente uma vez.
export function cascataValida(cascata: unknown): cascata is GrupoCascata[] {
  return (
    Array.isArray(cascata) &&
    cascata.length === GRUPOS_CASCATA.length &&
    GRUPOS_CASCATA.every((g) => cascata.includes(g))
  );
}

// Grupo da cascata de um item da fatura, a partir da MESMA classificação da
// carteira e da página (`chaveProdutoItemFatura`, §32.3) — recebe a chave e a
// parte já calculadas para não classificar duas vezes.
//   Encargos gravados (legado) → ENCARGOS; Proteção veicular → PROTECAO;
//   cota de acordo, Reembolso Parcelado, outros serviços → ACESSORIOS;
//   parcela do veículo, intermediária → PRINCIPAL.
// PROVISÓRIO (Regra 12, §32.5 não cobre): Termo de novação entra como PRINCIPAL
// (substitui o contrato do veículo) e Crédito avulso como ACESSORIOS (análogo
// ao Reembolso Parcelado).
export function grupoCascataDoItem(chave: { chave: string; parte: string }): GrupoCascata {
  if (chave.chave === 'encargos') return 'ENCARGOS';
  if (chave.chave === 'protecao_veicular') return 'PROTECAO';
  if (chave.parte === 'acordo' || chave.parte === 'avulso') return 'ACESSORIOS';
  if (chave.chave === 'compra_parcelada' || chave.chave === 'termo_novacao') return 'PRINCIPAL';
  return 'ACESSORIOS';
}

// ------------------------------------------------------------
// Entrada do motor
// ------------------------------------------------------------
// (ItemMotor, AlocacaoMotor, PagamentoMotor e FaturaMotor: ver @azit/types.)

// ------------------------------------------------------------
// Estado reconstituído (runtime, nunca gravado)
// ------------------------------------------------------------
export interface EstadoFatura {
  id: string;
  vencimento: string;
  itens: ItemMotor[];
  saldos: Map<string, number>; // saldo de face por item
  pendente: { multa: number; atualizacao: number }; // lançado e ainda não pago
  multaLancada: boolean;
  atualizacaoDesde: string; // marco: vencimento ou o último pagamento
  encargosPagos: { multa: number; atualizacao: number };
  pagamentos: PagamentoMotor[]; // em ordem cronológica
  face: number;
}

export interface EncargoFatura {
  multa: number; // pendente + nova
  atualizacao: number; // pendente + nova
  multaNova: number;
  atualizacaoNova: number;
  dias: number; // dias que a atualização nova cobre
}

const soma = (ns: number[]) => ns.reduce((a, n) => a + n, 0);

export function saldoNominal(e: EstadoFatura): number {
  return soma([...e.saldos.values()]);
}

function estadoInicial(f: FaturaMotor): EstadoFatura {
  return {
    id: f.id,
    vencimento: f.vencimento,
    itens: f.itens,
    saldos: new Map(f.itens.map((i) => [i.id, i.valor])),
    pendente: { multa: 0, atualizacao: 0 },
    multaLancada: false,
    atualizacaoDesde: f.vencimento,
    encargosPagos: { multa: 0, atualizacao: 0 },
    pagamentos: [],
    face: soma(f.itens.map((i) => i.valor)),
  };
}

// Encargo acumulado de uma fatura entre o último marco e `data` (§32.4):
//   · multa: UMA vez, sobre o saldo nominal do primeiro cálculo em atraso;
//   · atualização: pro-rata sobre o saldo nominal que ficou, contando do
//     vencimento ou do último pagamento — o que for mais recente (D-03).
// A fórmula é a do §7.2 (`detalharEncargoAtraso`), uma só. Itens de contratos
// com percentuais diferentes são somados por percentual antes de arredondar.
export function encargoAte(e: EstadoFatura, data: string): EncargoFatura {
  const emAtraso = data > e.vencimento;
  // Pagamento ANTES do vencimento não antecipa o marco: atraso só conta do vencimento.
  const marco = e.atualizacaoDesde > e.vencimento ? e.atualizacaoDesde : e.vencimento;
  const dias = emAtraso ? Math.max(0, diasCalendarioEntre(marco, data)) : 0;
  let multaNova = 0;
  let atualizacaoNova = 0;
  if (emAtraso) {
    const porTaxa = new Map<string, { saldo: number; multaPct: number; atualizacaoMesPct: number }>();
    for (const i of e.itens) {
      const saldo = e.saldos.get(i.id) ?? 0;
      if (saldo <= 0) continue;
      const k = `${i.multaPct}|${i.atualizacaoMesPct}`;
      const g = porTaxa.get(k) ?? { saldo: 0, multaPct: i.multaPct, atualizacaoMesPct: i.atualizacaoMesPct };
      g.saldo += saldo;
      porTaxa.set(k, g);
    }
    let multa = 0;
    let atualizacao = 0;
    for (const g of porTaxa.values()) {
      // dias = 1 só para a multa sair da fórmula única; a atualização usa os dias do marco.
      if (!e.multaLancada) multa += detalharEncargoAtraso(g.saldo, 1, g.multaPct, 0).multa;
      if (dias > 0) atualizacao += detalharEncargoAtraso(g.saldo, dias, 0, g.atualizacaoMesPct).atualizacao;
    }
    multaNova = Math.round(multa);
    atualizacaoNova = Math.round(atualizacao);
  }
  return {
    multa: e.pendente.multa + multaNova,
    atualizacao: e.pendente.atualizacao + atualizacaoNova,
    multaNova,
    atualizacaoNova,
    dias,
  };
}

// Total devido de uma fatura numa data: saldo de face + encargos.
export function totalDevidoEm(e: EstadoFatura, data: string): number {
  const enc = encargoAte(e, data);
  return saldoNominal(e) + enc.multa + enc.atualizacao;
}

// Registra no estado um pagamento COM as alocações dadas (as gravadas, na
// reconstituição; as recém-calculadas, na baixa). O encargo é lançado na data
// do pagamento; o que as alocações não cobrirem fica pendente.
function registrar(e: EstadoFatura, p: PagamentoMotor): void {
  const enc = encargoAte(e, p.data);
  let pagoMulta = 0;
  let pagoAtualizacao = 0;
  for (const a of p.alocacoes) {
    if (a.alvo === 'MULTA') pagoMulta += a.valor;
    else if (a.alvo === 'ATUALIZACAO') pagoAtualizacao += a.valor;
    else if (a.itemId) e.saldos.set(a.itemId, Math.max(0, (e.saldos.get(a.itemId) ?? 0) - a.valor));
  }
  if (enc.multaNova > 0) e.multaLancada = true;
  e.pendente = { multa: Math.max(0, enc.multa - pagoMulta), atualizacao: Math.max(0, enc.atualizacao - pagoAtualizacao) };
  e.encargosPagos = { multa: e.encargosPagos.multa + pagoMulta, atualizacao: e.encargosPagos.atualizacao + pagoAtualizacao };
  // Daqui em diante a atualização corre só sobre o que ficou (D-03).
  if (p.data > e.atualizacaoDesde) e.atualizacaoDesde = p.data;
  e.pagamentos.push(p);
}

// Refaz a conta de UMA fatura: itens + pagamentos registrados → estado de hoje.
// Usa as alocações GRAVADAS (não recalcula a cascata), então mudar o parâmetro
// FAT003 não reescreve o que pagamentos antigos já quitaram.
export function reconstituirFatura(f: FaturaMotor): EstadoFatura {
  const e = estadoInicial(f);
  const ordenados = [...f.pagamentos].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  for (const p of ordenados) registrar(e, p);
  return e;
}

// ------------------------------------------------------------
// Baixa pela conta (§32.4-A, §32.6-A)
// ------------------------------------------------------------
export interface BaixaFatura {
  faturaId: string;
  valor: number; // quanto do pagamento ficou nesta fatura
  alocacoes: AlocacaoMotor[];
  quitouFatura: boolean; // zerou saldo de face e encargos
  emAtraso: boolean; // pagamento depois do vencimento
}

export interface ResultadoBaixaConta {
  baixas: BaixaFatura[];
  excedente: number; // pago além de tudo o que a conta devia (§32.5: só registrado)
}

function emAbertoNoEstado(e: EstadoFatura): boolean {
  return saldoNominal(e) > 0 || e.pendente.multa > 0 || e.pendente.atualizacao > 0;
}

// Ordem da conta: da fatura mais antiga para a mais nova.
function ordenarPorAntiguidade<T extends { vencimento: string; id: string }>(fs: T[]): T[] {
  return [...fs].sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Aplica UM pagamento da conta, fatura a fatura, da mais antiga para a mais
// nova, com a cascata dentro de cada uma e o encargo calculado na DATA DO
// PAGAMENTO. MUTA os estados recebidos (para aplicar pagamentos em sequência)
// e devolve o que cada fatura recebeu.
export function aplicarPagamentoNaConta(
  estados: EstadoFatura[],
  pagamento: { data: string; valor: number },
  cascata: GrupoCascata[] = CASCATA_PADRAO,
): ResultadoBaixaConta {
  let resta = Math.max(0, Math.round(pagamento.valor));
  const baixas: BaixaFatura[] = [];
  for (const e of ordenarPorAntiguidade(estados)) {
    if (resta <= 0) break;
    if (!emAbertoNoEstado(e)) continue;
    const enc = encargoAte(e, pagamento.data);
    const nivelDe = (g: GrupoCascata) => cascata.indexOf(g) + 1;
    const alvos: { id: string; nivel: number; saldo: number; alvo: AlvoAlocacao; itemId: string | null }[] = [];
    if (enc.multa > 0) alvos.push({ id: 'multa', nivel: nivelDe('ENCARGOS'), saldo: enc.multa, alvo: 'MULTA', itemId: null });
    if (enc.atualizacao > 0) alvos.push({ id: 'atualizacao', nivel: nivelDe('ENCARGOS'), saldo: enc.atualizacao, alvo: 'ATUALIZACAO', itemId: null });
    for (const i of e.itens) {
      const saldo = e.saldos.get(i.id) ?? 0;
      if (saldo > 0) alvos.push({ id: `item:${i.id}`, nivel: nivelDe(i.grupo), saldo, alvo: 'ITEM', itemId: i.id });
    }
    const devido = soma(alvos.map((a) => a.saldo));
    const valor = Math.min(resta, devido);
    const { alocacoes } = imputarEmNiveis(valor, alvos);
    const porId = new Map(alvos.map((a) => [a.id, a]));
    const registradas: AlocacaoMotor[] = alocacoes
      .filter((a) => a.alocado > 0)
      .map((a) => {
        const alvo = porId.get(a.id)!;
        return { alvo: alvo.alvo, itemId: alvo.itemId, valor: a.alocado, nivel: a.nivel, quitou: a.saldo === 0 };
      });
    registrar(e, { data: pagamento.data, valor, alocacoes: registradas });
    baixas.push({ faturaId: e.id, valor, alocacoes: registradas, quitouFatura: !emAbertoNoEstado(e), emAtraso: pagamento.data > e.vencimento });
    resta -= valor;
  }
  return { baixas, excedente: resta };
}

// ------------------------------------------------------------
// Projeção do dia (o que a página, a ficha e a intenção leem)
// ------------------------------------------------------------
export type SituacaoMotor = 'paga' | 'parcial' | 'vencida' | 'hoje' | 'aberta';

export interface FaturaProjetada {
  id: string;
  vencimento: string;
  face: number;
  saldoNominal: number;
  saldos: Map<string, number>;
  diasAtraso: number; // desde o vencimento
  encargo: { multa: number; atualizacao: number; dias: number; desde: string; multaJaPaga: boolean };
  encargosPagos: { multa: number; atualizacao: number };
  totalHoje: number;
  pagoTotal: number;
  situacao: SituacaoMotor;
  aVencer: boolean; // vencimento depois de hoje
  pagamentos: PagamentoMotor[];
}

export interface ContaProjetada {
  faturas: FaturaProjetada[]; // todas, da mais antiga para a mais nova
  abertas: FaturaProjetada[];
  pagas: FaturaProjetada[];
  vencidas: FaturaProjetada[]; // em aberto, vencidas OU que vencem hoje
  totalAberto: number;
  totalVencido: number;
  acumulado: number[]; // acumulado[i] = pagar da mais antiga até a (i+1)-ésima em aberto
  selecaoPadrao: number; // S-04: até a última vencida ou que vence hoje (mínimo 1)
}

function projetarEstado(e: EstadoFatura, hoje: string): FaturaProjetada {
  const nominal = saldoNominal(e);
  const enc = encargoAte(e, hoje);
  const aberta = emAbertoNoEstado(e) || enc.multa > 0 || enc.atualizacao > 0;
  const diasAtraso = Math.max(0, diasCalendarioEntre(e.vencimento, hoje));
  const situacao: SituacaoMotor = !aberta
    ? 'paga'
    : e.pagamentos.length > 0
      ? 'parcial'
      : diasAtraso > 0
        ? 'vencida'
        : e.vencimento === hoje
          ? 'hoje'
          : 'aberta';
  return {
    id: e.id,
    vencimento: e.vencimento,
    face: e.face,
    saldoNominal: nominal,
    saldos: new Map(e.saldos),
    diasAtraso,
    encargo: {
      multa: aberta ? enc.multa : 0,
      atualizacao: aberta ? enc.atualizacao : 0,
      dias: enc.dias,
      desde: e.atualizacaoDesde > e.vencimento ? e.atualizacaoDesde : e.vencimento,
      multaJaPaga: e.multaLancada && enc.multa === 0,
    },
    encargosPagos: { ...e.encargosPagos },
    totalHoje: aberta ? nominal + enc.multa + enc.atualizacao : 0,
    pagoTotal: soma(e.pagamentos.map((p) => p.valor)),
    situacao,
    aVencer: e.vencimento > hoje,
    pagamentos: e.pagamentos,
  };
}

export function projetarEstados(estados: EstadoFatura[], hoje: string): ContaProjetada {
  const faturas = ordenarPorAntiguidade(estados).map((e) => projetarEstado(e, hoje));
  const abertas = faturas.filter((f) => f.situacao !== 'paga');
  const pagas = faturas.filter((f) => f.situacao === 'paga');
  const vencidas = abertas.filter((f) => !f.aVencer);
  let corrente = 0;
  const acumulado = abertas.map((f) => (corrente += f.totalHoje));
  return {
    faturas,
    abertas,
    pagas,
    vencidas,
    totalAberto: corrente,
    totalVencido: soma(vencidas.map((f) => f.totalHoje)),
    acumulado,
    selecaoPadrao: Math.max(1, vencidas.length),
  };
}

// Projeção do saldo de hoje da conta: reconstitui cada fatura e soma.
// `simulados` = pagamentos AINDA NÃO registrados aplicados por cima (o "e se
// pagar R$ X hoje" da página e dos testes).
export function projetarConta(
  faturas: FaturaMotor[],
  hoje: string,
  simulados: { data: string; valor: number }[] = [],
  cascata: GrupoCascata[] = CASCATA_PADRAO,
): ContaProjetada {
  const estados = faturas.map(reconstituirFatura);
  for (const p of simulados) aplicarPagamentoNaConta(estados, p, cascata);
  return projetarEstados(estados, hoje);
}

// ------------------------------------------------------------
// Pagar outro valor (§32.6 FAT004 + §32.6-A D-07)
// ------------------------------------------------------------
export type TipoRegraParcial = 'antiga' | 'uma' | 'sem-parcial';
export interface RegraParcial {
  tipo: TipoRegraParcial;
  minimo: number;
  maximo: number;
}

// Mínimo do parcial de UMA fatura: o maior entre N% do valor de FACE e o piso
// (nunca sobre o saldo atualizado).
export function minimoParcialFatura(face: number, p: Pick<ParametrosMotorFatura, 'minimoParcialPct' | 'minimoParcialPiso'>): number {
  return Math.max(Math.round((face * p.minimoParcialPct) / 100), p.minimoParcialPiso);
}

// Regra do "Pagar outro valor" da conta:
//   · duas ou mais faturas vencidas ou de hoje → o mínimo é a mais antiga INTEIRA;
//   · senão, FAT004 sobre a mais antiga em aberto (fatura a vencer não trava);
//   · saldo da mais antiga ≤ mínimo → não há parcial, só o total.
// O máximo é sempre o total em aberto da conta. `null` = nada em aberto.
export function regraParcial(k: ContaProjetada, p: Pick<ParametrosMotorFatura, 'minimoParcialPct' | 'minimoParcialPiso'>): RegraParcial | null {
  const maisAntiga = k.abertas[0];
  if (!maisAntiga) return null;
  if (k.vencidas.length > 1) return { tipo: 'antiga', minimo: maisAntiga.totalHoje, maximo: k.totalAberto };
  const minimo = minimoParcialFatura(maisAntiga.face, p);
  if (maisAntiga.totalHoje <= minimo) return { tipo: 'sem-parcial', minimo: maisAntiga.totalHoje, maximo: k.totalAberto };
  return { tipo: 'uma', minimo, maximo: k.totalAberto };
}

export type MotivoValorInvalido = 'nada_em_aberto' | 'abaixo_do_minimo' | 'acima_do_total' | 'sem_parcial';

// Um valor de pagamento é aceito quando é EXATAMENTE "da mais antiga até a
// N-ésima" (qualquer N) ou um "outro valor" dentro da regra do parcial.
// `faturasCobertas` = quantas em aberto o valor quita por inteiro.
export function validarValorPagamento(
  k: ContaProjetada,
  p: Pick<ParametrosMotorFatura, 'minimoParcialPct' | 'minimoParcialPiso'>,
  valor: number,
): { ok: true; outroValor: boolean; faturasCobertas: number } | { ok: false; motivo: MotivoValorInvalido; regra: RegraParcial | null } {
  const regra = regraParcial(k, p);
  if (!regra || valor <= 0) return { ok: false, motivo: 'nada_em_aberto', regra };
  const cobertas = k.acumulado.filter((a) => a <= valor).length;
  if (k.acumulado.includes(valor)) return { ok: true, outroValor: false, faturasCobertas: cobertas };
  if (valor > regra.maximo) return { ok: false, motivo: 'acima_do_total', regra };
  if (regra.tipo === 'sem-parcial') return { ok: false, motivo: 'sem_parcial', regra };
  if (valor < regra.minimo) return { ok: false, motivo: 'abaixo_do_minimo', regra };
  return { ok: true, outroValor: true, faturasCobertas: cobertas };
}

// ------------------------------------------------------------
// Saldo do motor POR ITEM (acordo, novação, rescisão, sinistro)
// ------------------------------------------------------------
// Os fluxos que olham a dívida por PARCELA (não pela fatura) precisam do que o
// motor diz que falta de cada item — nunca do nominal cheio com encargo desde o
// vencimento, que cobraria de novo o que um pagamento em parte já quitou.
// O encargo da fatura (multa pendente/nova + atualização desde o último
// pagamento) é rateado entre os itens na proporção do saldo de cada um; o
// último item com saldo absorve o centavo. A soma dos itens é sempre o total
// da fatura na data (`totalDevidoEm`).
export interface SaldoItemFatura {
  itemId: string;
  grupo: GrupoCascata;
  face: number; // valor de face do item
  pago: number; // já alocado neste item
  saldo: number; // o que falta do valor de face
  multa: number; // parte da multa da fatura atribuída a este item
  atualizacao: number; // idem, atualização por dias de atraso
}

export interface SaldosDaFatura {
  faturaId: string;
  itens: SaldoItemFatura[];
  saldoNominal: number;
  multa: number;
  atualizacao: number;
  total: number; // saldoNominal + multa + atualizacao
  dias: number; // dias que a atualização cobre (desde o vencimento ou o último pagamento)
}

export function saldosPorItem(f: FaturaMotor, data: string): SaldosDaFatura {
  const e = reconstituirFatura(f);
  const enc = encargoAte(e, data);
  const base = f.itens.map((i) => ({ id: i.id, nivel: 1, saldo: e.saldos.get(i.id) ?? 0 }));
  const nominal = soma(base.map((b) => b.saldo));
  const ratear = (valor: number): Map<string, number> => {
    if (valor <= 0) return new Map();
    // Sem saldo de face (só encargo pendente): fica no primeiro item.
    if (nominal <= 0) return new Map(f.itens.length ? [[f.itens[0].id, valor]] : []);
    return new Map(imputarEmNiveis(Math.min(valor, nominal), base).alocacoes.map((a) => [a.id, a.alocado]));
  };
  const multa = ratear(enc.multa);
  const atualizacao = ratear(enc.atualizacao);
  const itens: SaldoItemFatura[] = f.itens.map((i) => {
    const saldo = e.saldos.get(i.id) ?? 0;
    return { itemId: i.id, grupo: i.grupo, face: i.valor, pago: i.valor - saldo, saldo, multa: multa.get(i.id) ?? 0, atualizacao: atualizacao.get(i.id) ?? 0 };
  });
  return { faturaId: f.id, itens, saldoNominal: nominal, multa: enc.multa, atualizacao: enc.atualizacao, total: nominal + enc.multa + enc.atualizacao, dias: enc.dias };
}
