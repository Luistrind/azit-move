// ============================================================
// VISÃO DA CARTEIRA POR PERÍODO — função ÚNICA (Regra 16; doc 02 §27, decisão
// Luís 30/10/2026). Cartões (teto / recebido / vencidas / a vencer), "por
// produto", mês a mês e comparação com o mês anterior saem TODOS desta
// agregação: o backend carrega as faturas do período (por vencimento) e os
// recebimentos do período (por data de pagamento) e chama
// `agregarVisaoCarteira`; o frontend só exibe. Nenhuma tela refaz a conta.
//
// Definições (doc 02 §27, revisadas em 30/10 após a conferência com o Asaas):
//   · TETO, VENCIDAS e A VENCER são POR VENCIMENTO: entram as faturas cujo
//     vencimento cai no período. Teto = soma do valorTotal (o que entra se todo
//     mundo pagar); RENEGOCIADA/NOVADA ficam FORA (foram substituídas);
//   · PAGAS = faturas do período já PAGA | PAGA_EM_ATRASO (valorTotal, para fechar
//     com o teto: pagas + vencidas + a vencer = teto). É o progresso do mês;
//   · RECEBIDO é CAIXA, POR DATA DE PAGAMENTO: tudo que entrou na conta dentro do
//     período — faturas de QUALQUER vencimento pagas no período (valorPago) mais
//     as entradas de contrato e de acordo (lançamentos da conta). "Quero saber
//     quanto recebi no mês, não se a fatura era do mês anterior" (Luís, 30/10);
//   · ENCARGOS recebidos = excedente pago sobre o valorTotal das faturas do caixa;
//   · VENCIDAS = ABERTA | FECHADA com vencimento < hoje (fuso Brasil);
//   · A VENCER = ABERTA | FECHADA com vencimento ≥ hoje (inclui "vence hoje");
//   · clientes = contas distintas em cada conjunto;
//   · POR PRODUTO: a linha nasce do item da fatura (`chaveProdutoItemFatura`),
//     nunca de uma lista fixa — produto novo no Catálogo aparece sozinho. Cada
//     linha tem teto e pago do período (por vencimento) e recebido (caixa);
//     entradas de contrato/acordo são linhas próprias, sem teto.
// ============================================================
import { TipoContrato } from './tipo-contrato';
import { diasCalendarioEntre, somarDiasISO } from './datas';

export type EstadoFaturaVisao = 'recebida' | 'vencida' | 'a_vencer' | 'fora';

export interface ItemFaturaVisao {
  tipo: string; // PRINCIPAL | SERVICO | ENCARGO | INTERMEDIARIA | ENTRADA (qualquer caixa)
  descricao: string;
  valor: number; // centavos
  // Contexto que só o service conhece (parcela → item contratado → contrato).
  origemItem?: string | null; // VENDA | ACORDO
  tipoContrato?: TipoContrato | null;
}

export interface FaturaVisao {
  contaId: string;
  status: string; // StatusFatura (qualquer caixa)
  vencimento: string; // YYYY-MM-DD (data-calendário, já no fuso do negócio)
  valorTotal: number; // centavos
  valorPago?: number | null; // centavos
  itens: ItemFaturaVisao[];
}

// Um recebimento do caixa: fatura paga (de qualquer vencimento) ou entrada
// avulsa (lançamento da conta — contrato ou acordo).
export type OrigemRecebimento = 'fatura' | 'entrada_contrato' | 'entrada_acordo';

export interface RecebimentoVisao {
  contaId: string;
  origem: OrigemRecebimento;
  dataPagamento: string; // YYYY-MM-DD (data-calendário, fuso do negócio)
  valor: number; // centavos efetivamente pagos
  vencimento?: string | null; // fatura: dia do vencimento (decide "do período" × "de outro período")
  valorTotal?: number | null; // fatura: valor de face — o excedente pago é encargo
  itens?: ItemFaturaVisao[]; // fatura: composição, para o "por produto"
}

export interface ProdutoVisao {
  chave: string;
  rotulo: string;
  teto: number; // centavos — soma do item nas faturas do período (por vencimento)
  pagoDoPeriodo: number; // centavos — soma do item nas faturas do período já pagas
  recebido: number; // centavos — CAIXA: soma do item nos recebimentos do período (qualquer vencimento)
}

export interface ResumoEstado {
  valor: number; // centavos
  faturas: number;
  clientes: number;
}

export interface ResumoRecebido {
  valor: number; // centavos — tudo que entrou no período
  recebimentos: number; // faturas pagas + entradas
  clientes: number; // contas distintas
  faturasDoPeriodo: number; // centavos pagos de faturas com vencimento dentro do período
  faturasDeOutrosPeriodos: number; // centavos pagos de faturas de outros vencimentos (atrasadas de antes, antecipadas)
  entradas: number; // centavos de entradas de contrato e de acordo
  encargos: number; // centavos — excedente pago sobre o valorTotal das faturas
}

export interface VisaoCarteira {
  teto: ResumoEstado;
  pagas: ResumoEstado & { valorPago: number }; // faturas do período já pagas (progresso do teto)
  vencidas: ResumoEstado;
  aVencer: ResumoEstado;
  recebido: ResumoRecebido; // caixa do período, por data de pagamento
  porProduto: ProdutoVisao[]; // ordenado por teto desc (entradas, sem teto, vão ao fim); encargos NÃO entram aqui
  encargosRecebidos: number; // centavos — o mesmo que recebido.encargos
}

export interface VisaoMensal extends VisaoCarteira {
  mes: string; // YYYY-MM
}

export interface Periodo { de: string; ate: string }

export interface CaixaVisao {
  recebimentos: RecebimentoVisao[];
  periodo: Periodo; // separa faturas "do período" das "de outros períodos"
}

const ESTADO_DOS_STATUS: Record<string, EstadoFaturaVisao | 'aberta'> = {
  PAGA: 'recebida',
  PAGA_EM_ATRASO: 'recebida',
  ABERTA: 'aberta',
  FECHADA: 'aberta',
  RENEGOCIADA: 'fora',
  NOVADA: 'fora',
};

// Estado da fatura na visão — "vencida"/"a vencer" são runtime (Regra 7), o
// status real nunca grava isso. `hoje` é a data-calendário no fuso do negócio.
export function estadoFaturaVisao(status: string, vencimento: string, hoje: string): EstadoFaturaVisao {
  const e = ESTADO_DOS_STATUS[String(status).toUpperCase()];
  if (!e) return 'fora';
  if (e !== 'aberta') return e;
  return vencimento < hoje ? 'vencida' : 'a_vencer';
}

export interface ChaveProduto {
  chave: string;
  rotulo: string;
  foraDoTeto: boolean; // encargo: receita de atraso, não compõe o teto
}

const ROTULO_TIPO_CONTRATO: Record<TipoContrato, ChaveProduto> = {
  veiculo: { chave: 'compra_parcelada', rotulo: 'Compra Parcelada', foraDoTeto: false },
  reembolso: { chave: 'reembolso_parcelado', rotulo: 'Reembolso Parcelado', foraDoTeto: false },
  credito: { chave: 'credito_avulso', rotulo: 'Crédito avulso', foraDoTeto: false },
  termo_novacao: { chave: 'termo_novacao', rotulo: 'Termo de novação', foraDoTeto: false },
};
const ACORDO: ChaveProduto = { chave: 'acordo', rotulo: 'Acordo (renegociação)', foraDoTeto: false };

// Linhas das entradas avulsas no "por produto" (sem teto — não são cronograma).
const PRODUTO_ENTRADA: Record<Exclude<OrigemRecebimento, 'fatura'>, ChaveProduto> = {
  entrada_contrato: { chave: 'entrada_contrato', rotulo: 'Entrada de contrato', foraDoTeto: false },
  entrada_acordo: { chave: 'entrada_acordo', rotulo: 'Entrada de acordo', foraDoTeto: false },
};

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Produto de um item da fatura. Serviço (proteção, taxa…) é identificado pela
// própria descrição — sem lista fixa; "(legado)" é só marca de origem e cai.
// Principal/intermediária seguem o contrato da parcela: cota de acordo (item de
// origem ACORDO) → acordo; senão o tipo do contrato (`classificarContrato`).
// Sem contexto (item sem parcela), a descrição decide.
export function chaveProdutoItemFatura(item: ItemFaturaVisao): ChaveProduto {
  const tipo = String(item.tipo).toUpperCase();
  const descricao = (item.descricao ?? '').replace(/\s*\(legado\)\s*$/i, '').trim();
  if (tipo === 'ENCARGO') return { chave: 'encargos', rotulo: 'Encargos de atraso', foraDoTeto: true };
  if (tipo === 'SERVICO') return { chave: slug(descricao) || 'servico', rotulo: descricao || 'Serviço', foraDoTeto: false };
  if (tipo === 'INTERMEDIARIA') return { chave: 'intermediaria', rotulo: 'Intermediária (entrada diluída)', foraDoTeto: false };
  if (tipo === 'ENTRADA') return { chave: 'entrada', rotulo: 'Entrada', foraDoTeto: false };
  // PRINCIPAL
  if (String(item.origemItem ?? '').toUpperCase() === 'ACORDO') return ACORDO;
  if (item.tipoContrato) return ROTULO_TIPO_CONTRATO[item.tipoContrato];
  if (/renegocia|acordo/i.test(descricao)) return ACORDO;
  if (/reembolso/i.test(descricao)) return ROTULO_TIPO_CONTRATO.reembolso;
  return ROTULO_TIPO_CONTRATO.veiculo;
}

function resumo(): ResumoEstado & { contas: Set<string> } {
  return { valor: 0, faturas: 0, clientes: 0, contas: new Set<string>() };
}
function fechar(r: ResumoEstado & { contas: Set<string> }): ResumoEstado {
  return { valor: r.valor, faturas: r.faturas, clientes: r.contas.size };
}

const SEM_CAIXA: CaixaVisao = { recebimentos: [], periodo: { de: '0000-00-00', ate: '9999-99-99' } };

export function agregarVisaoCarteira(faturas: FaturaVisao[], hoje: string, caixa: CaixaVisao = SEM_CAIXA): VisaoCarteira {
  const teto = resumo(), pag = resumo(), venc = resumo(), aven = resumo();
  let valorPago = 0;
  const produtos = new Map<string, ProdutoVisao>();
  const linhaDe = (p: ChaveProduto): ProdutoVisao => {
    let linha = produtos.get(p.chave);
    if (!linha) { linha = { chave: p.chave, rotulo: p.rotulo, teto: 0, pagoDoPeriodo: 0, recebido: 0 }; produtos.set(p.chave, linha); }
    return linha;
  };

  // 1) Por vencimento: teto e seu progresso (pagas / vencidas / a vencer).
  for (const f of faturas) {
    const estado = estadoFaturaVisao(f.status, f.vencimento, hoje);
    if (estado === 'fora') continue;
    const alvo = estado === 'recebida' ? pag : estado === 'vencida' ? venc : aven;
    for (const r of [teto, alvo]) { r.valor += f.valorTotal; r.faturas += 1; r.contas.add(f.contaId); }
    if (estado === 'recebida') valorPago += f.valorPago ?? f.valorTotal;
    for (const it of f.itens) {
      const p = chaveProdutoItemFatura(it);
      if (p.foraDoTeto) continue;
      const linha = linhaDe(p);
      linha.teto += it.valor;
      if (estado === 'recebida') linha.pagoDoPeriodo += it.valor;
    }
  }

  // 2) Caixa: o que entrou no período, por data de pagamento, de qualquer vencimento.
  // Encargo recebido = o que entrou ALÉM do valor da fatura (padrão do sistema,
  // decisão Luís 30/10): a conciliação nativa não vira item, só `valorPago` maior
  // que `valorTotal`; o item ENCARGO do legado é o mesmo excedente escrito como
  // linha — informativo, fora do teto, não somado.
  const rec: ResumoRecebido & { contas: Set<string> } = {
    valor: 0, recebimentos: 0, clientes: 0, faturasDoPeriodo: 0, faturasDeOutrosPeriodos: 0, entradas: 0, encargos: 0, contas: new Set<string>(),
  };
  for (const r of caixa.recebimentos) {
    rec.valor += r.valor;
    rec.recebimentos += 1;
    rec.contas.add(r.contaId);
    if (r.origem === 'fatura') {
      const doPeriodo = !!r.vencimento && r.vencimento >= caixa.periodo.de && r.vencimento <= caixa.periodo.ate;
      if (doPeriodo) rec.faturasDoPeriodo += r.valor; else rec.faturasDeOutrosPeriodos += r.valor;
      if (r.valorTotal != null) rec.encargos += Math.max(0, r.valor - r.valorTotal);
      for (const it of r.itens ?? []) {
        const p = chaveProdutoItemFatura(it);
        if (p.foraDoTeto) continue;
        linhaDe(p).recebido += it.valor;
      }
    } else {
      rec.entradas += r.valor;
      linhaDe(PRODUTO_ENTRADA[r.origem]).recebido += r.valor;
    }
  }
  const { contas, ...recebido } = rec;
  recebido.clientes = contas.size;

  return {
    teto: fechar(teto),
    pagas: { ...fechar(pag), valorPago },
    vencidas: fechar(venc),
    aVencer: fechar(aven),
    recebido,
    // Teto desc; linhas sem teto (entradas, produto só recebido) depois, por recebido desc.
    porProduto: [...produtos.values()].sort((a, b) => (b.teto - a.teto) || (b.recebido - a.recebido)),
    encargosRecebidos: recebido.encargos,
  };
}

// Mês a mês: a mesma agregação, uma vez por mês — faturas pelo mês de VENCIMENTO,
// recebimentos pelo mês de PAGAMENTO. Meses sem nada não aparecem — quem exibe
// preenche a série.
export function agregarVisaoMensal(faturas: FaturaVisao[], hoje: string, recebimentos: RecebimentoVisao[] = []): VisaoMensal[] {
  const porMes = new Map<string, { faturas: FaturaVisao[]; recebimentos: RecebimentoVisao[] }>();
  const slot = (mes: string) => {
    let s = porMes.get(mes);
    if (!s) { s = { faturas: [], recebimentos: [] }; porMes.set(mes, s); }
    return s;
  };
  for (const f of faturas) slot(f.vencimento.slice(0, 7)).faturas.push(f);
  for (const r of recebimentos) slot(r.dataPagamento.slice(0, 7)).recebimentos.push(r);
  return [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([mes, s]) => ({ mes, ...agregarVisaoCarteira(s.faturas, hoje, { recebimentos: s.recebimentos, periodo: periodoDoMes(mes) }) }));
}

// Variação percentual inteira entre dois valores (atual × anterior); null quando
// não há base. Usada pela comparação "mesmo trecho do mês anterior".
export function variacaoPct(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round((100 * (atual - anterior)) / anterior);
}

// ------------------------------------------------------------
// PERÍODOS da visão (doc 02 §27.4). Tudo em data-calendário YYYY-MM-DD.
// ------------------------------------------------------------
function diasDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes 1–12
}

export function periodoDoMes(anoMes: string): Periodo {
  const [a, m] = anoMes.split('-').map(Number);
  return { de: `${anoMes}-01`, ate: `${anoMes}-${String(diasDoMes(a, m)).padStart(2, '0')}` };
}

export function mesAnterior(anoMes: string): string {
  const [a, m] = anoMes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

export function mesSeguinte(anoMes: string): string {
  const [a, m] = anoMes.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

// Comparação "mesmo trecho": o período em curso é cortado em `hoje`, e o
// anterior tem o MESMO tamanho, começando no mesmo ponto do mês anterior
// (1–29/out × 1–29/set) ou imediatamente antes (semana × semana anterior).
// Período inteiramente futuro não tem comparação (null).
export function periodoAnteriorMesmoTrecho(
  periodo: Periodo,
  hoje: string,
  anoMes?: string, // informado quando o período é um mês fechado do seletor
): { atual: Periodo; anterior: Periodo } | null {
  if (periodo.de > hoje) return null;
  const ate = periodo.ate < hoje ? periodo.ate : hoje;
  const atual = { de: periodo.de, ate };
  const tamanho = diasCalendarioEntre(periodo.de, ate);
  if (anoMes) {
    const antMes = periodoDoMes(mesAnterior(anoMes));
    const fimAnt = somarDiasISO(antMes.de, tamanho);
    return { atual, anterior: { de: antMes.de, ate: fimAnt < antMes.ate ? fimAnt : antMes.ate } };
  }
  const total = diasCalendarioEntre(periodo.de, periodo.ate) + 1;
  const deAnt = somarDiasISO(periodo.de, -total);
  return { atual, anterior: { de: deAnt, ate: somarDiasISO(deAnt, tamanho) } };
}
