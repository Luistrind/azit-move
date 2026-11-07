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
//   · POR PRODUTO (revisão Luís 31/10): só PRODUTO vira linha — os tipos de
//     contrato (Compra Parcelada, Reembolso Parcelado, Crédito avulso, Termo de
//     novação) e os serviços do Catálogo (Proteção veicular, Taxa de boleto e
//     PIX, Clube de benefícios). Acordo/renegociação, entrada de contrato,
//     entrada de acordo, intermediária e pagamento parcial/avulso NÃO são
//     produto: somam DENTRO do produto a que pertencem (por padrão a Compra
//     Parcelada) e aparecem só como COMPOSIÇÃO da linha ("deixar a visão, o
//     valor em si é dentro do compra parcelada"). Cada linha tem teto e pago do
//     período (por vencimento) e recebido (caixa).
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

// Parte de um produto: como o dinheiro daquele produto se apresenta. NÃO é
// produto (decisão 31/10) — só composição da linha, para leitura.
export type ParteProduto = 'parcela' | 'acordo' | 'intermediaria' | 'entrada_contrato' | 'entrada_acordo' | 'avulso';

export const ROTULO_PARTE: Record<ParteProduto, string> = {
  parcela: 'Parcelas',
  acordo: 'Acordo / renegociação',
  intermediaria: 'Intermediárias (entrada diluída)',
  entrada_contrato: 'Entradas de contrato',
  entrada_acordo: 'Entradas de acordo',
  avulso: 'Pagamentos parciais e avulsos',
};

export interface ParteVisao {
  parte: ParteProduto;
  rotulo: string;
  teto: number; // centavos
  pagoDoPeriodo: number; // centavos
  recebido: number; // centavos
}

export interface ProdutoVisao {
  chave: string;
  rotulo: string;
  teto: number; // centavos — soma do item nas faturas do período (por vencimento)
  pagoDoPeriodo: number; // centavos — soma do item nas faturas do período já pagas
  recebido: number; // centavos — CAIXA: soma do item nos recebimentos do período (qualquer vencimento)
  composicao: ParteVisao[]; // só as partes com valor, na ordem de ROTULO_PARTE
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
  RESCINDIDA: 'fora', // extinta pela rescisão (doc 02 §29): nem teto nem vencida
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
  parte: ParteProduto; // como o valor se apresenta dentro do produto (composição)
}

const ROTULO_TIPO_CONTRATO: Record<TipoContrato, { chave: string; rotulo: string }> = {
  veiculo: { chave: 'compra_parcelada', rotulo: 'Compra Parcelada' },
  reembolso: { chave: 'reembolso_parcelado', rotulo: 'Reembolso Parcelado' },
  credito: { chave: 'credito_avulso', rotulo: 'Crédito avulso' },
  termo_novacao: { chave: 'termo_novacao', rotulo: 'Termo de novação' },
};

// Serviços que SÃO produto do Catálogo (linha própria). Fonte única desta
// identificação: a descrição do item é livre (vem do Catálogo/legado), por isso
// o casamento é por padrão. Serviço que não casa aqui é lançamento avulso
// (ex.: "Pagamento parcial da parcela do dia…") e soma dentro do produto.
const PRODUTOS_SERVICO: { chave: string; rotulo: string; casa: RegExp }[] = [
  { chave: 'protecao_veicular', rotulo: 'Proteção veicular', casa: /prote[cç][aã]o/i },
  { chave: 'taxa_de_boleto_e_pix', rotulo: 'Taxa de boleto e PIX', casa: /taxa/i },
  { chave: 'clube_de_beneficios', rotulo: 'Clube de benefícios', casa: /clube/i },
];

const ENCARGOS: ChaveProduto = { chave: 'encargos', rotulo: 'Encargos de atraso', foraDoTeto: true, parte: 'avulso' };

function produtoDoContrato(tipo: TipoContrato | null | undefined, parte: ParteProduto): ChaveProduto {
  const base = ROTULO_TIPO_CONTRATO[tipo ?? 'veiculo'];
  return { ...base, foraDoTeto: false, parte };
}

// Produto (linha) e parte (composição) de um item da fatura — decisão 31/10:
//   · SERVICO que é produto do Catálogo (proteção, taxa, clube) → linha própria;
//     qualquer outro serviço é avulso e soma no produto do contrato (Compra
//     Parcelada quando o item não tem parcela);
//   · PRINCIPAL/INTERMEDIARIA seguem o contrato da parcela (`classificarContrato`):
//     cota de acordo (origem ACORDO, ou descrição de renegociação no legado) é
//     parte "acordo" DO MESMO produto, nunca linha própria; intermediária é parte
//     "intermediaria" da Compra Parcelada;
//   · ENCARGO fica fora do teto (receita de atraso).
export function chaveProdutoItemFatura(item: ItemFaturaVisao): ChaveProduto {
  const tipo = String(item.tipo).toUpperCase();
  const descricao = (item.descricao ?? '').replace(/\s*\(legado\)\s*$/i, '').trim();
  if (tipo === 'ENCARGO') return ENCARGOS;
  if (tipo === 'SERVICO') {
    const prod = PRODUTOS_SERVICO.find((p) => p.casa.test(descricao));
    if (prod) return { chave: prod.chave, rotulo: prod.rotulo, foraDoTeto: false, parte: 'parcela' };
    return produtoDoContrato(item.tipoContrato, 'avulso');
  }
  if (tipo === 'INTERMEDIARIA') return produtoDoContrato(item.tipoContrato ?? 'veiculo', 'intermediaria');
  if (tipo === 'ENTRADA') return produtoDoContrato(item.tipoContrato ?? 'veiculo', 'entrada_contrato');
  // PRINCIPAL
  const acordo = String(item.origemItem ?? '').toUpperCase() === 'ACORDO' || (!item.tipoContrato && /renegocia|acordo/i.test(descricao));
  if (item.tipoContrato) return produtoDoContrato(item.tipoContrato, acordo ? 'acordo' : 'parcela');
  if (/reembolso/i.test(descricao)) return produtoDoContrato('reembolso', 'parcela');
  return produtoDoContrato('veiculo', acordo ? 'acordo' : 'parcela');
}

// Entradas avulsas (lançamentos da conta) são parte da Compra Parcelada — não produto.
const PRODUTO_ENTRADA: Record<Exclude<OrigemRecebimento, 'fatura'>, ChaveProduto> = {
  entrada_contrato: produtoDoContrato('veiculo', 'entrada_contrato'),
  entrada_acordo: produtoDoContrato('veiculo', 'entrada_acordo'),
};

function resumo(): ResumoEstado & { contas: Set<string> } {
  return { valor: 0, faturas: 0, clientes: 0, contas: new Set<string>() };
}
function fechar(r: ResumoEstado & { contas: Set<string> }): ResumoEstado {
  return { valor: r.valor, faturas: r.faturas, clientes: r.contas.size };
}

const ORDEM_PARTES = Object.keys(ROTULO_PARTE) as ParteProduto[];
function ordenarPartes(partes: ParteVisao[]): ParteVisao[] {
  return partes
    .filter((c) => c.teto || c.pagoDoPeriodo || c.recebido)
    .sort((a, b) => ORDEM_PARTES.indexOf(a.parte) - ORDEM_PARTES.indexOf(b.parte));
}

const SEM_CAIXA: CaixaVisao = { recebimentos: [], periodo: { de: '0000-00-00', ate: '9999-99-99' } };

export function agregarVisaoCarteira(faturas: FaturaVisao[], hoje: string, caixa: CaixaVisao = SEM_CAIXA): VisaoCarteira {
  const teto = resumo(), pag = resumo(), venc = resumo(), aven = resumo();
  let valorPago = 0;
  const produtos = new Map<string, ProdutoVisao>();
  // Soma no produto E na parte (composição): a linha é o produto; a parte só explica.
  const somar = (p: ChaveProduto, campo: 'teto' | 'pagoDoPeriodo' | 'recebido', valor: number) => {
    let linha = produtos.get(p.chave);
    if (!linha) { linha = { chave: p.chave, rotulo: p.rotulo, teto: 0, pagoDoPeriodo: 0, recebido: 0, composicao: [] }; produtos.set(p.chave, linha); }
    linha[campo] += valor;
    let parte = linha.composicao.find((c) => c.parte === p.parte);
    if (!parte) { parte = { parte: p.parte, rotulo: ROTULO_PARTE[p.parte], teto: 0, pagoDoPeriodo: 0, recebido: 0 }; linha.composicao.push(parte); }
    parte[campo] += valor;
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
      somar(p, 'teto', it.valor);
      if (estado === 'recebida') somar(p, 'pagoDoPeriodo', it.valor);
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
        somar(p, 'recebido', it.valor);
      }
    } else {
      rec.entradas += r.valor;
      somar(PRODUTO_ENTRADA[r.origem], 'recebido', r.valor);
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
    // Teto desc; produto só recebido (sem teto) depois, por recebido desc.
    // Composição na ordem de ROTULO_PARTE (parcelas primeiro), só partes com valor.
    porProduto: [...produtos.values()]
      .map((l) => ({ ...l, composicao: ordenarPartes(l.composicao) }))
      .sort((a, b) => (b.teto - a.teto) || (b.recebido - a.recebido)),
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
