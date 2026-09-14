import { calcularEncargoAtraso } from './calculations';
import { valorPresenteMensal } from './precificacao';

const DIAS_FREQUENCIA = { semanal: 7, quinzenal: 14, mensal: 30 } as const;
export type FrequenciaNovacao = keyof typeof DIAS_FREQUENCIA;

// ============================================================
// NOVAÇÃO — F1: decomposição do saldo por produto (A7 passos 1–2 do doc
// docs/novacao-adaptacoes-azit-2026-09.md, decisões Luís 13/09/2026).
//
// A unidade da novação é a FATURA (A1): o que existe de dívida real são as
// parcelas/itens em aberto da conta, cada um pertencendo a um produto que tem
// estrutura jurídica própria. Este motor recebe esse retrato JÁ CLASSIFICADO
// (montagem é do service — aqui só regra de cálculo, puro e testável) e produz:
//
//   - parteVeiculo  → insumo do Contrato 1 (novação do veículo);
//   - demaisProdutos → insumo do Contrato 2 (Termo de Regularização de Débitos:
//     reembolso + seguro vencido + parte não-veículo de renegociações).
//
// Regras de valoração (A7 passo 1):
//   - VENCIDO: saldo + multa 2% + juros de mora 1% a.m. pró-rata (base 30) —
//     taxas herdadas do contrato de origem (default 2/1).
//   - FUTURO: valor presente pela taxa mensal do contrato/produto de ORIGEM
//     (VP = VF/(1+d)^dias, d diária equivalente). Todo o futuro do veículo
//     entra (a novação extingue a obrigação inteira); seguro futuro NUNCA
//     entra (A3 — o serviço continua); comissão não existe aqui (A4 — é
//     interna à precificação, não dívida do cliente).
//   - ACORDO anterior: explodido pela composição original coberta; os juros e
//     encargos do acordo (valor do plano − nominal coberto) são divididos em
//     PARTES IGUAIS entre os produtos da composição; o saldo em aberto do
//     acordo (valorado pelas mesmas regras acima) é rateado na proporção da
//     dívida por produto assim reconstituída. Acordo que cobriu parcelas de
//     acordo ANTERIOR referencia o pai (ref) — resolvido em cadeia.
//
// Tudo em CENTAVOS (inteiros); arredondamento por maior-resto nos rateios
// (a soma das partes SEMPRE fecha com o todo).
// ============================================================

export type ProdutoNovacao = 'veiculo' | 'seguro' | 'reembolso' | 'outro';

export interface ComponenteNovacao {
  /** Rótulo para a memória de cálculo (ex.: 'Parcela 12/209 · Fiat Mobi'). */
  origem: string;
  produto: ProdutoNovacao;
  contratoId?: string;
  faturaId?: string;
  valorNominal: number; // centavos
  situacao: 'vencido' | 'futuro';
  /** Dias de atraso (vencido) ou até o vencimento (futuro). */
  dias: number;
  taxaMultaPercent?: number; // vencido — default 2 (%)
  taxaJurosMensalPercent?: number; // vencido — default 1 (% a.m. pró-rata)
  taxaVpMensal?: number; // futuro — fração a.m. de origem (0/ausente = nominal)
}

/** Parcela em aberto de um plano de acordo (produto sai do rateio, não daqui). */
export type ParcelaAbertaAcordo = Omit<ComponenteNovacao, 'produto'>;

export type ComposicaoCoberta =
  | { produto: ProdutoNovacao; valorNominal: number }
  | { ref: string; valorNominal: number }; // cobriu parcelas do acordo `ref`

export interface AcordoNovacao {
  acordoId: string;
  /** Nominal coberto na origem, por produto (ou referência a acordo anterior). */
  composicao: ComposicaoCoberta[];
  /** Σ dos itens ACORDO gerados (plano novo, com TP/TR/mora herdada embutidos). */
  valorItens: number;
  /** Parcelas EM ABERTO do plano do acordo (vencidas e futuras). */
  parcelasAbertas: ParcelaAbertaAcordo[];
}

export interface ComponenteValorado {
  origem: string;
  produto: ProdutoNovacao;
  contratoId?: string;
  faturaId?: string;
  situacao: 'vencido' | 'futuro';
  dias: number;
  valorNominal: number;
  /** Mora (vencido, >=0) ou desconto de VP (futuro, <=0). */
  ajuste: number;
  valor: number; // nominal + ajuste
}

export interface AcordoExplodido {
  acordoId: string;
  saldoAberto: number; // Σ parcelas abertas valoradas
  nominalCoberto: number; // Σ composição resolvida
  encargosAcordo: number; // valorItens − nominalCoberto (>= 0)
  /** Dívida reconstituída por produto (nominal + encargos/N) e fatia do saldo. */
  porProduto: { produto: ProdutoNovacao; dividaOriginal: number; saldo: number }[];
  parcelasAbertas: ComponenteValorado[];
}

export interface ResultadoDecomposicaoNovacao {
  parteVeiculo: { vencido: number; futuro: number; deAcordos: number; total: number };
  demaisProdutos: {
    porProduto: {
      produto: ProdutoNovacao;
      vencido: number;
      futuro: number;
      deAcordos: number;
      total: number;
    }[];
    total: number;
  };
  totalGeral: number;
  memoria: {
    componentes: ComponenteValorado[];
    acordos: AcordoExplodido[];
    /** Futuros de seguro descartados (A3) — auditável, nunca silencioso. */
    ignorados: { origem: string; produto: ProdutoNovacao; motivo: string; valorNominal: number }[];
  };
}

/** Valora um componente: mora do vencido / valor presente do futuro. */
export function valorarComponenteNovacao(
  c: Omit<ComponenteNovacao, 'produto'> & { produto?: ProdutoNovacao },
): { valor: number; ajuste: number } {
  if (c.situacao === 'vencido') {
    const encargo = Math.round(
      calcularEncargoAtraso(c.valorNominal, c.dias, c.taxaMultaPercent ?? 2, c.taxaJurosMensalPercent ?? 1),
    );
    return { valor: c.valorNominal + encargo, ajuste: encargo };
  }
  const vp = Math.round(valorPresenteMensal(c.valorNominal, c.taxaVpMensal ?? 0, c.dias));
  return { valor: vp, ajuste: vp - c.valorNominal };
}

/** Rateia `total` na proporção dos `pesos`, resto por maior-resto (soma fecha). */
export function ratearProporcional(total: number, pesos: number[]): number[] {
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  if (somaPesos <= 0) {
    // Sem pesos: partes iguais (mesma disciplina de resto).
    return ratearProporcional(total, pesos.map(() => 1));
  }
  const exatos = pesos.map((p) => (total * p) / somaPesos);
  const pisos = exatos.map((e) => Math.floor(e));
  let resto = total - pisos.reduce((s, p) => s + p, 0);
  const ordem = exatos
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const resultado = [...pisos];
  for (let k = 0; resto > 0; k++, resto--) resultado[ordem[k % ordem.length].i] += 1;
  return resultado;
}

/**
 * Reconstitui a dívida por produto de um acordo: nominal coberto por produto
 * + encargos do acordo divididos em PARTES IGUAIS entre os produtos (A7).
 */
export function reconstituirDividaAcordo(
  composicao: { produto: ProdutoNovacao; valorNominal: number }[],
  valorItens: number,
): { produto: ProdutoNovacao; dividaOriginal: number }[] {
  const porProduto = new Map<ProdutoNovacao, number>();
  for (const c of composicao) {
    porProduto.set(c.produto, (porProduto.get(c.produto) ?? 0) + c.valorNominal);
  }
  const produtos = [...porProduto.entries()];
  const nominal = produtos.reduce((s, [, v]) => s + v, 0);
  const encargos = Math.max(0, valorItens - nominal);
  const partesIguais = ratearProporcional(encargos, produtos.map(() => 1));
  return produtos.map(([produto, v], i) => ({ produto, dividaOriginal: v + partesIguais[i] }));
}

export function decomporSaldoNovacao(input: {
  componentes: ComponenteNovacao[];
  acordos: AcordoNovacao[];
}): ResultadoDecomposicaoNovacao {
  const ignorados: ResultadoDecomposicaoNovacao['memoria']['ignorados'] = [];
  const componentes: ComponenteValorado[] = [];

  // 1. Componentes diretos (parcelas/itens fora de acordo).
  for (const c of input.componentes) {
    // A3 — seguro futuro nunca entra: o serviço continua; defensivo e auditado.
    if (c.produto === 'seguro' && c.situacao === 'futuro') {
      ignorados.push({
        origem: c.origem,
        produto: c.produto,
        motivo: 'seguro futuro não é novado — o contrato de proteção continua (A3)',
        valorNominal: c.valorNominal,
      });
      continue;
    }
    const { valor, ajuste } = valorarComponenteNovacao(c);
    componentes.push({
      origem: c.origem,
      produto: c.produto,
      contratoId: c.contratoId,
      faturaId: c.faturaId,
      situacao: c.situacao,
      dias: c.dias,
      valorNominal: c.valorNominal,
      ajuste,
      valor,
    });
  }

  // 2. Acordos: resolver referências em cadeia (acordo que cobriu acordo) e
  //    explodir cada um pela composição reconstituída.
  const dividasPorAcordo = new Map<string, { produto: ProdutoNovacao; dividaOriginal: number }[]>();
  const resolverComposicao = (
    acordoId: string,
    visitados: Set<string>,
  ): { produto: ProdutoNovacao; valorNominal: number }[] => {
    const acordo = input.acordos.find((a) => a.acordoId === acordoId);
    if (!acordo) throw new Error(`Novação: acordo referenciado não informado (${acordoId})`);
    if (visitados.has(acordoId)) throw new Error(`Novação: ciclo de acordos (${acordoId})`);
    visitados.add(acordoId);
    const resolvida: { produto: ProdutoNovacao; valorNominal: number }[] = [];
    for (const c of acordo.composicao) {
      if ('produto' in c) {
        resolvida.push(c);
        continue;
      }
      // Parcela coberta pertencia ao plano de um acordo anterior: o nominal
      // coberto se decompõe na proporção da dívida por produto DAQUELE acordo.
      const dividasPai =
        dividasPorAcordo.get(c.ref) ??
        reconstituirDividaAcordo(
          resolverComposicao(c.ref, visitados),
          input.acordos.find((a) => a.acordoId === c.ref)!.valorItens,
        );
      dividasPorAcordo.set(c.ref, dividasPai);
      const fatias = ratearProporcional(c.valorNominal, dividasPai.map((d) => d.dividaOriginal));
      dividasPai.forEach((d, i) => resolvida.push({ produto: d.produto, valorNominal: fatias[i] }));
    }
    return resolvida;
  };

  const acordosExplodidos: AcordoExplodido[] = input.acordos.map((a) => {
    const composicaoResolvida = resolverComposicao(a.acordoId, new Set());
    const dividas = dividasPorAcordo.get(a.acordoId) ?? reconstituirDividaAcordo(composicaoResolvida, a.valorItens);
    dividasPorAcordo.set(a.acordoId, dividas);
    const nominalCoberto = composicaoResolvida.reduce((s, c) => s + c.valorNominal, 0);

    const parcelasAbertas: ComponenteValorado[] = a.parcelasAbertas.map((p) => {
      const { valor, ajuste } = valorarComponenteNovacao(p);
      return { ...p, produto: 'outro' as const, ajuste, valor };
    });
    const saldoAberto = parcelasAbertas.reduce((s, p) => s + p.valor, 0);
    const fatias = ratearProporcional(saldoAberto, dividas.map((d) => d.dividaOriginal));
    return {
      acordoId: a.acordoId,
      saldoAberto,
      nominalCoberto,
      encargosAcordo: Math.max(0, a.valorItens - nominalCoberto),
      porProduto: dividas.map((d, i) => ({ ...d, saldo: fatias[i] })),
      parcelasAbertas,
    };
  });

  // 3. Agregação: parte do veículo × demais produtos.
  const soma = (produto: ProdutoNovacao, situacao: 'vencido' | 'futuro') =>
    componentes.filter((c) => c.produto === produto && c.situacao === situacao).reduce((s, c) => s + c.valor, 0);
  const deAcordos = (produto: ProdutoNovacao) =>
    acordosExplodidos.reduce(
      (s, a) => s + a.porProduto.filter((p) => p.produto === produto).reduce((x, p) => x + p.saldo, 0),
      0,
    );

  const veiculo = {
    vencido: soma('veiculo', 'vencido'),
    futuro: soma('veiculo', 'futuro'),
    deAcordos: deAcordos('veiculo'),
    total: 0,
  };
  veiculo.total = veiculo.vencido + veiculo.futuro + veiculo.deAcordos;

  const demais: ProdutoNovacao[] = ['reembolso', 'seguro', 'outro'];
  const porProduto = demais
    .map((produto) => {
      const linha = {
        produto,
        vencido: soma(produto, 'vencido'),
        futuro: soma(produto, 'futuro'),
        deAcordos: deAcordos(produto),
        total: 0,
      };
      linha.total = linha.vencido + linha.futuro + linha.deAcordos;
      return linha;
    })
    .filter((l) => l.total > 0);
  const totalDemais = porProduto.reduce((s, l) => s + l.total, 0);

  return {
    parteVeiculo: veiculo,
    demaisProdutos: { porProduto, total: totalDemais },
    totalGeral: veiculo.total + totalDemais,
    memoria: { componentes, acordos: acordosExplodidos, ignorados },
  };
}

// ============================================================
// NOVAÇÃO — precificação da proposta (A7 passos 3–4; NV001–019 do V1.0).
//
// Contrato 1 (veículo): saldo-base = parte do veículo + ajuste da troca (FIPE
// entra − sai); desconto SÓ do comitê → saldo novado; taxa inicial de
// processamento = max(2% × saldo-base; R$ 3.990), UMA vez na operação, alocada
// aqui; recebimento inicial (opcional — novação não costuma ter): mínimo =
// max(1% × saldo novado; taxa inicial), taxa apropriada primeiro, sobra
// amortiza; o restante vai à Price 1,70% a.m. com taxa equivalente por
// frequência ((1+i)^(dias/30) − 1), ajuste residual na última parcela.
//
// Contrato 2 (Termo de Regularização de Débitos) é pago PRIMEIRO (A6): o
// saldo dos demais produtos é amortizado à MESMA parcela do veículo e à mesma
// taxa; a última parcela dele (resto < parcela) forma a FATURA DE TRANSIÇÃO,
// completada com uma antecipação do veículo até o valor periódico padrão — a
// antecipação abate o saldo do veículo ANTES do cronograma dele começar.
// Durante a fase do Contrato 2 o saldo do veículo NÃO rende juros (congelado;
// repasses do investidor e comissões da Azit idem — fora deste motor).
// ============================================================

export interface ParametrosPrecificacaoNovacao {
  saldoVeiculo: number; // centavos — parteVeiculo.total da decomposição (F1)
  saldoDemais: number; // centavos — demaisProdutos.total da decomposição (F1)
  ajusteTrocaVeiculo?: number; // centavos (FIPE do que entra − do que sai; F3)
  desconto?: number; // centavos — SÓ com aprovação do comitê
  recebimentoInicial?: number; // centavos (0 = sem recebimento inicial)
  numeroParcelasVeiculo: number; // prazo escolhido para o contrato do veículo
  frequencia: FrequenciaNovacao;
  taxaMensal?: number; // NV010 — fração a.m. (default 0,017)
  taxaInicialPct?: number; // fração sobre o saldo-base (default 0,02)
  taxaInicialMinima?: number; // centavos (default R$ 3.990)
  entradaMinimaPct?: number; // fração sobre o saldo novado (default 0,01)
  prazoMaximoMeses?: number; // NV — default 60
}

export interface FaseContrato {
  saldo: number; // centavos — o que a fase amortiza
  parcelasCheias: number; // parcelas no valor periódico padrão
  valorUltima: number; // última parcela (ajuste residual; <= parcela padrão)
  totalParcelas: number; // parcelasCheias + (valorUltima > 0 ? 1 : 0)
}

export interface ResultadoPrecificacaoNovacao {
  saldoBase: number;
  saldoNovado: number;
  taxaInicial: number;
  entradaMinima: number; // mínimo operacional quando HÁ recebimento inicial
  tpFinanciada: number; // parte da taxa inicial não coberta pelo recebimento
  amortizacaoInicial: number; // o que do recebimento inicial abate o saldo
  saldoAParcelarVeiculo: number; // SP antes da antecipação da transição
  taxaPeriodo: number; // fração por período
  valorParcela: number; // o valor periódico único que o cliente sente
  contrato2: FaseContrato & { antecipacaoTransicao: number };
  contrato1: FaseContrato; // já líquido da antecipação da transição
  totalParcelasRelacionamento: number;
  totalAPagar: number; // recebimento inicial + todas as faturas
  excecoes: string[];
}

// Amortiza `saldo` a parcela fixa `pmt` com juros `i` por período: quantas
// parcelas cheias cabem e qual o resíduo da última (com os juros do período).
function amortizarAParcelaFixa(saldo: number, pmt: number, i: number): FaseContrato {
  if (saldo <= 0) return { saldo: 0, parcelasCheias: 0, valorUltima: 0, totalParcelas: 0 };
  let s = saldo;
  let cheias = 0;
  // 1040 períodos ≈ 20 anos semanais: acima disso a parcela não amortiza.
  while (cheias < 1040) {
    const comJuros = Math.round(s * (1 + i));
    if (comJuros <= pmt) {
      return { saldo, parcelasCheias: cheias, valorUltima: comJuros, totalParcelas: cheias + (comJuros > 0 ? 1 : 0) };
    }
    s = comJuros - pmt;
    cheias += 1;
  }
  throw new Error('Novação: a parcela não amortiza o saldo (juros do período maiores que a parcela)');
}

export function precificarNovacao(p: ParametrosPrecificacaoNovacao): ResultadoPrecificacaoNovacao {
  const n1 = p.numeroParcelasVeiculo;
  if (!Number.isInteger(n1) || n1 < 1) {
    throw new Error('numeroParcelasVeiculo deve ser inteiro >= 1');
  }
  const taxaMensal = p.taxaMensal ?? 0.017;
  const taxaInicialPct = p.taxaInicialPct ?? 0.02;
  const taxaInicialMinima = p.taxaInicialMinima ?? 399000;
  const entradaMinimaPct = p.entradaMinimaPct ?? 0.01;
  const prazoMaximoMeses = p.prazoMaximoMeses ?? 60;
  const desconto = p.desconto ?? 0;
  const recebimento = p.recebimentoInicial ?? 0;
  const excecoes: string[] = [];

  // Passo 3 — cadeia do contrato do veículo.
  const saldoBase = p.saldoVeiculo + (p.ajusteTrocaVeiculo ?? 0);
  if (saldoBase <= 0) throw new Error('Novação: saldo-base do veículo deve ser positivo');
  if (desconto > 0) excecoes.push('desconto aplicado — exige aprovação do comitê (CONAC)');
  const saldoNovado = saldoBase - Math.min(desconto, saldoBase);
  const taxaInicial = Math.max(Math.round(saldoBase * taxaInicialPct), taxaInicialMinima);
  const entradaMinima = Math.max(Math.round(saldoNovado * entradaMinimaPct), taxaInicial);
  if (recebimento > 0 && recebimento < entradaMinima) {
    excecoes.push('recebimento inicial abaixo do mínimo operacional (max(1% do saldo novado; taxa inicial))');
  }
  const tpCoberta = Math.min(taxaInicial, recebimento);
  const tpFinanciada = taxaInicial - tpCoberta;
  const amortizacaoInicial = Math.max(0, recebimento - taxaInicial);
  const sp = saldoNovado - amortizacaoInicial + tpFinanciada;

  const dias = DIAS_FREQUENCIA[p.frequencia];
  const i = Math.pow(1 + taxaMensal, dias / 30) - 1;
  const pmt = i === 0 ? sp / n1 : (sp * (i * Math.pow(1 + i, n1))) / (Math.pow(1 + i, n1) - 1);
  // Para CIMA: com o PMT arredondado para baixo sobraria um resíduo de centavos
  // além da parcela n1 — o ajuste residual fica sempre NA última, para menos.
  const valorParcela = Math.ceil(pmt);

  // Passo 4 — Contrato 2 primeiro, à mesma parcela e mesma taxa.
  const fase2 = amortizarAParcelaFixa(p.saldoDemais, valorParcela, i);
  const antecipacaoTransicao = fase2.totalParcelas > 0 ? Math.max(0, valorParcela - fase2.valorUltima) : 0;

  // Contrato do veículo: saldo CONGELADO na fase do Contrato 2 (não rende
  // juros), abatido pela antecipação da transição, e só então amortizado.
  const saldoVeiculoLiquido = Math.max(0, sp - antecipacaoTransicao);
  const fase1 = amortizarAParcelaFixa(saldoVeiculoLiquido, valorParcela, i);

  const totalParcelas = fase2.totalParcelas + fase1.totalParcelas;
  const maxParcelas = Math.floor((prazoMaximoMeses * 30) / dias);
  if (totalParcelas > maxParcelas) {
    excecoes.push(`prazo total de ${totalParcelas} parcelas excede o máximo de ${prazoMaximoMeses} meses (${maxParcelas} parcelas ${p.frequencia}s)`);
  }
  const somaFase = (f: FaseContrato) => f.parcelasCheias * valorParcela + f.valorUltima;
  // A transição cobra a parcela padrão inteira (resto do C2 + antecipação).
  const totalAPagar =
    recebimento + somaFase(fase2) + antecipacaoTransicao + somaFase(fase1);

  return {
    saldoBase,
    saldoNovado,
    taxaInicial,
    entradaMinima,
    tpFinanciada,
    amortizacaoInicial,
    saldoAParcelarVeiculo: sp,
    taxaPeriodo: i,
    valorParcela,
    contrato2: { ...fase2, antecipacaoTransicao },
    contrato1: fase1,
    totalParcelasRelacionamento: totalParcelas,
    totalAPagar,
    excecoes,
  };
}
