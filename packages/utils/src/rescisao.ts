import { calcularEncargoAtraso } from './calculations';
import { diasCalendarioEntre } from './datas';

// Rescisão por inadimplência (doc 02 §29, decisão Luís 04/11/2026) — a conta do
// acerto existe UMA vez (Regra 16) e é chamada pelo backend; a tela só exibe.
//
//   base dos 20%   = principal pago = entrada paga + (pago − encargos − proteção) das parcelas pagas
//   crédito        = 20% da base (PERCENTUAL_CREDITO_RESCISAO)
//   dívida vencida = parcelas em aberto com vencimento ≤ data-base, nominal + encargo na data-base
//                    (parcela de fatura AZIT paga em parte: o SALDO e o encargo do motor, §32.4-A)
//   + custos da recuperação que são do cliente (orçados e pagos) e multas do veículo (§29.3, 20/11)
//   compensado     = mín(crédito, dívida) — os 20% abatem a dívida TODA (parcelas, encargo, custos, multas)
//   crédito > dívida → a devolver ao cliente; dívida > crédito → saldo remanescente do cliente
//   parcelas futuras (> data-base) não são cobradas (o contrato se resolve com a retomada)

/** Parte do principal pago que volta ao cliente na rescisão (cláusula 8.4.2: o vendedor retém 80%). */
export const PERCENTUAL_CREDITO_RESCISAO = 20;

export interface ParcelaPagaRescisao {
  display: string;
  valorNominal: number; // centavos
  valorPago: number | null; // centavos — null em pagas sem valor (legado): vale o nominal
  valorEncargo: number | null; // centavos — encargo de atraso pago junto
  protecao: number; // centavos — proteção veicular embutida na parcela (itens SERVICO da parcela)
}

export interface ParcelaAbertaRescisao {
  id: string;
  display: string;
  valorNominal: number; // centavos
  dataVencimento: string; // 'YYYY-MM-DD'
  // Fatura AZIT (doc 02 §32.4-A): o que o MOTOR diz que falta desta parcela e o
  // encargo dela na data-base. Quando vêm, valem no lugar de "nominal cheio +
  // encargo desde o vencimento" — o que já foi pago em parte não é cobrado de novo.
  saldoNominal?: number; // centavos
  encargoCalculado?: number; // centavos
}

export interface ParcelaVencidaAcerto {
  id: string;
  display: string;
  dataVencimento: string;
  diasAtraso: number;
  valorNominal: number;
  encargo: number;
  total: number;
}

// Custo da recuperação repassado ao cliente (doc 02 §29.3): lançamento de custo
// do veículo ligado ao contrato. Orçado entra pelo valor orçado, como estimativa.
export interface CustoAcerto {
  id: string;
  tipo: string;
  descricao: string;
  valor: number; // centavos
  orcado: boolean;
}

// Multa/ocorrência do veículo de responsabilidade do cliente, sem desfecho (§25).
export interface MultaAcerto {
  id: string;
  descricao: string;
  valor: number; // centavos
}

export interface AcertoRescisao {
  dataBase: string;
  percentualCredito: number;
  entradaPaga: number;
  parcelasPagas: number; // quantidade
  principalParcelas: number; // inclui o principal parcial abaixo
  principalParcial: number; // principal já pago de parcelas AINDA em aberto (pagamento em parte)
  principalPago: number; // entrada + parcelas
  valorCredito: number;
  vencidas: ParcelaVencidaAcerto[];
  dividaVencida: number; // nominal
  encargosVencidos: number;
  // §29.3 (20/11). Opcionais só porque acertos gravados antes não os têm.
  custos?: CustoAcerto[];
  custosCliente?: number; // soma dos custos (orçados + pagos)
  custosOrcados?: number; // parte da soma que ainda é estimativa
  multas?: MultaAcerto[];
  multasVeiculo?: number;
  dividaTotal: number; // parcelas + encargo + custos + multas
  valorCompensado: number;
  valorADevolver: number;
  saldoRemanescente: number;
  futuras: { quantidade: number; valorNominal: number }; // não cobradas
}

export function calcularAcertoRescisao(entrada: {
  dataBase: string; // 'YYYY-MM-DD' — data da retomada do veículo
  entradaPaga: number; // centavos
  parcelasPagas: ParcelaPagaRescisao[];
  parcelasAbertas: ParcelaAbertaRescisao[]; // em aberto, fora de acordo
  taxaMultaPercent: number;
  taxaJurosMensalPercent: number;
  percentualCredito?: number;
  // Principal (sem proteção nem encargo) que pagamentos em parte já quitaram em
  // parcelas ainda em aberto — também é "principal pago" e entra na base dos 20%.
  principalParcial?: number; // centavos
  custos?: CustoAcerto[]; // só os que o cliente paga
  multas?: MultaAcerto[];
}): AcertoRescisao {
  const percentual = entrada.percentualCredito ?? PERCENTUAL_CREDITO_RESCISAO;
  const entradaPaga = Math.max(0, Math.round(entrada.entradaPaga));

  let principalParcelas = 0;
  for (const p of entrada.parcelasPagas) {
    const pago = (p.valorPago ?? p.valorNominal) - (p.valorEncargo ?? 0);
    principalParcelas += Math.max(0, Math.round(pago - Math.max(0, p.protecao)));
  }
  const principalParcial = Math.max(0, Math.round(entrada.principalParcial ?? 0));
  principalParcelas += principalParcial;
  const principalPago = entradaPaga + principalParcelas;
  const valorCredito = Math.round((principalPago * percentual) / 100);

  const vencidas: ParcelaVencidaAcerto[] = [];
  let futurasQtd = 0;
  let futurasValor = 0;
  for (const p of [...entrada.parcelasAbertas].sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))) {
    const dias = diasCalendarioEntre(p.dataVencimento, entrada.dataBase);
    const falta = p.saldoNominal ?? p.valorNominal;
    if (dias < 0) {
      futurasQtd += 1;
      futurasValor += falta;
      continue;
    }
    const encargo =
      p.encargoCalculado !== undefined
        ? Math.max(0, Math.round(p.encargoCalculado))
        : Math.round(calcularEncargoAtraso(falta, dias, entrada.taxaMultaPercent, entrada.taxaJurosMensalPercent));
    vencidas.push({ id: p.id, display: p.display, dataVencimento: p.dataVencimento, diasAtraso: dias, valorNominal: falta, encargo, total: falta + encargo });
  }
  const dividaVencida = vencidas.reduce((s, v) => s + v.valorNominal, 0);
  const encargosVencidos = vencidas.reduce((s, v) => s + v.encargo, 0);
  const custos = (entrada.custos ?? []).map((c) => ({ ...c, valor: Math.max(0, Math.round(c.valor)) }));
  const multas = (entrada.multas ?? []).map((m) => ({ ...m, valor: Math.max(0, Math.round(m.valor)) }));
  const custosCliente = custos.reduce((s, c) => s + c.valor, 0);
  const custosOrcados = custos.filter((c) => c.orcado).reduce((s, c) => s + c.valor, 0);
  const multasVeiculo = multas.reduce((s, m) => s + m.valor, 0);
  const dividaTotal = dividaVencida + encargosVencidos + custosCliente + multasVeiculo;
  const valorCompensado = Math.min(valorCredito, dividaTotal);

  return {
    dataBase: entrada.dataBase,
    percentualCredito: percentual,
    entradaPaga,
    parcelasPagas: entrada.parcelasPagas.length,
    principalParcelas,
    principalParcial,
    principalPago,
    valorCredito,
    vencidas,
    dividaVencida,
    encargosVencidos,
    custos,
    custosCliente,
    custosOrcados,
    multas,
    multasVeiculo,
    dividaTotal,
    valorCompensado,
    valorADevolver: Math.max(0, valorCredito - dividaTotal),
    saldoRemanescente: Math.max(0, dividaTotal - valorCredito),
    futuras: { quantidade: futurasQtd, valorNominal: futurasValor },
  };
}

// Depois da rescisão efetivada (doc 02 §29.3): custo lançado, alterado ou
// retirado recalcula o resultado com o MESMO crédito, as MESMAS parcelas
// vencidas e as MESMAS multas — só a lista de custos muda. As parcelas já estão
// RESCINDIDA no banco, então a conta parte do acerto gravado, não dos fatos.
export function reaplicarCustosNoAcerto(acerto: AcertoRescisao, custosAtuais: CustoAcerto[]): AcertoRescisao {
  const custos = custosAtuais.map((c) => ({ ...c, valor: Math.max(0, Math.round(c.valor)) }));
  const multas = acerto.multas ?? [];
  const custosCliente = custos.reduce((s, c) => s + c.valor, 0);
  const custosOrcados = custos.filter((c) => c.orcado).reduce((s, c) => s + c.valor, 0);
  const multasVeiculo = multas.reduce((s, m) => s + m.valor, 0);
  const dividaTotal = acerto.dividaVencida + acerto.encargosVencidos + custosCliente + multasVeiculo;
  return {
    ...acerto,
    custos,
    custosCliente,
    custosOrcados,
    multas,
    multasVeiculo,
    dividaTotal,
    valorCompensado: Math.min(acerto.valorCredito, dividaTotal),
    valorADevolver: Math.max(0, acerto.valorCredito - dividaTotal),
    saldoRemanescente: Math.max(0, dividaTotal - acerto.valorCredito),
  };
}
