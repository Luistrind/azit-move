// ============================================================
// VISÃO DA CARTEIRA POR PERÍODO — função ÚNICA (Regra 16; doc 02 §27, decisão
// Luís 30/10/2026). Cartões (teto / recebidas / vencidas / a vencer), "por
// produto", mês a mês e comparação com o mês anterior saem TODOS desta
// agregação: o backend carrega as faturas do período e chama `agregarVisaoCarteira`;
// o frontend só exibe. Nenhuma tela refaz a conta.
//
// Definições (doc 02 §27):
//   · a visão é POR VENCIMENTO: entram as faturas cujo vencimento cai no período;
//   · TETO do período = soma do valorTotal dessas faturas (o que entra se todo
//     mundo pagar). Faturas RENEGOCIADA/NOVADA ficam FORA (foram substituídas);
//   · RECEBIDAS = PAGA | PAGA_EM_ATRASO (valor = valorTotal, para fechar com o
//     teto; o que veio a mais é encargo e aparece em `encargosRecebidos`);
//   · VENCIDAS = ABERTA | FECHADA com vencimento < hoje (fuso Brasil);
//   · A VENCER = ABERTA | FECHADA com vencimento ≥ hoje (inclui "vence hoje");
//   · clientes = contas distintas em cada estado;
//   · POR PRODUTO: a linha nasce do item da fatura (`chaveProdutoItemFatura`),
//     nunca de uma lista fixa — produto novo no Catálogo aparece sozinho.
// ============================================================
import { TipoContrato } from './tipo-contrato';

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

export interface ProdutoVisao {
  chave: string;
  rotulo: string;
  teto: number; // centavos — soma do item em todas as faturas do teto
  recebido: number; // centavos — soma do item nas faturas recebidas
}

export interface ResumoEstado {
  valor: number; // centavos
  faturas: number;
  clientes: number;
}

export interface VisaoCarteira {
  teto: ResumoEstado;
  recebidas: ResumoEstado & { valorPago: number };
  vencidas: ResumoEstado;
  aVencer: ResumoEstado;
  porProduto: ProdutoVisao[]; // ordenado por teto desc; encargos NÃO entram aqui
  encargosRecebidos: number; // centavos: itens ENCARGO pagos + excedente pago sobre o total
}

export interface VisaoMensal extends VisaoCarteira {
  mes: string; // YYYY-MM
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

export function agregarVisaoCarteira(faturas: FaturaVisao[], hoje: string): VisaoCarteira {
  const teto = resumo(), rec = resumo(), venc = resumo(), aven = resumo();
  let valorPago = 0;
  let encargosRecebidos = 0;
  const produtos = new Map<string, ProdutoVisao>();

  for (const f of faturas) {
    const estado = estadoFaturaVisao(f.status, f.vencimento, hoje);
    if (estado === 'fora') continue;
    const alvo = estado === 'recebida' ? rec : estado === 'vencida' ? venc : aven;
    for (const r of [teto, alvo]) { r.valor += f.valorTotal; r.faturas += 1; r.contas.add(f.contaId); }
    // Encargo recebido: o item ENCARGO fica FORA do valorTotal (legado grava o
    // excedente pago como item) — por fatura vale o MAIOR entre o item e o
    // excedente (pago − total), nunca a soma dos dois.
    let encargoItens = 0;
    if (estado === 'recebida') {
      const pago = f.valorPago ?? f.valorTotal;
      valorPago += pago;
      for (const it of f.itens) if (chaveProdutoItemFatura(it).foraDoTeto) encargoItens += it.valor;
      encargosRecebidos += Math.max(encargoItens, pago - f.valorTotal, 0);
    }
    for (const it of f.itens) {
      const p = chaveProdutoItemFatura(it);
      if (p.foraDoTeto) continue;
      let linha = produtos.get(p.chave);
      if (!linha) { linha = { chave: p.chave, rotulo: p.rotulo, teto: 0, recebido: 0 }; produtos.set(p.chave, linha); }
      linha.teto += it.valor;
      if (estado === 'recebida') linha.recebido += it.valor;
    }
  }

  return {
    teto: fechar(teto),
    recebidas: { ...fechar(rec), valorPago },
    vencidas: fechar(venc),
    aVencer: fechar(aven),
    porProduto: [...produtos.values()].sort((a, b) => b.teto - a.teto),
    encargosRecebidos,
  };
}

// Mês a mês: a mesma agregação, uma vez por mês de vencimento (YYYY-MM).
// Meses sem fatura não aparecem — quem exibe preenche a série.
export function agregarVisaoMensal(faturas: FaturaVisao[], hoje: string): VisaoMensal[] {
  const porMes = new Map<string, FaturaVisao[]>();
  for (const f of faturas) {
    const mes = f.vencimento.slice(0, 7);
    const lista = porMes.get(mes);
    if (lista) lista.push(f); else porMes.set(mes, [f]);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([mes, lista]) => ({ mes, ...agregarVisaoCarteira(lista, hoje) }));
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
export interface Periodo { de: string; ate: string }

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

function somarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
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
  const tamanho = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${periodo.de}T00:00:00Z`)) / 86_400_000);
  if (anoMes) {
    const antMes = periodoDoMes(mesAnterior(anoMes));
    const fimAnt = somarDias(antMes.de, tamanho);
    return { atual, anterior: { de: antMes.de, ate: fimAnt < antMes.ate ? fimAnt : antMes.ate } };
  }
  const total = Math.round((Date.parse(`${periodo.ate}T00:00:00Z`) - Date.parse(`${periodo.de}T00:00:00Z`)) / 86_400_000) + 1;
  const deAnt = somarDias(periodo.de, -total);
  return { atual, anterior: { de: deAnt, ate: somarDias(deAnt, tamanho) } };
}
