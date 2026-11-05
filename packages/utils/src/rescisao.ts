import { calcularEncargoAtraso } from './calculations';
import { diasCalendarioEntre } from './datas';

// Rescisão por inadimplência (doc 02 §29, decisão Luís 04/11/2026) — a conta do
// acerto existe UMA vez (Regra 16) e é chamada pelo backend; a tela só exibe.
//
//   base dos 20%   = principal pago = entrada paga + (pago − encargos − proteção) das parcelas pagas
//   crédito        = 20% da base (PERCENTUAL_CREDITO_RESCISAO)
//   dívida vencida = parcelas em aberto com vencimento ≤ data-base, nominal + encargo na data-base
//   compensado     = mín(crédito, dívida)
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

export interface AcertoRescisao {
  dataBase: string;
  percentualCredito: number;
  entradaPaga: number;
  parcelasPagas: number; // quantidade
  principalParcelas: number;
  principalPago: number; // entrada + parcelas
  valorCredito: number;
  vencidas: ParcelaVencidaAcerto[];
  dividaVencida: number; // nominal
  encargosVencidos: number;
  dividaTotal: number;
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
}): AcertoRescisao {
  const percentual = entrada.percentualCredito ?? PERCENTUAL_CREDITO_RESCISAO;
  const entradaPaga = Math.max(0, Math.round(entrada.entradaPaga));

  let principalParcelas = 0;
  for (const p of entrada.parcelasPagas) {
    const pago = (p.valorPago ?? p.valorNominal) - (p.valorEncargo ?? 0);
    principalParcelas += Math.max(0, Math.round(pago - Math.max(0, p.protecao)));
  }
  const principalPago = entradaPaga + principalParcelas;
  const valorCredito = Math.round((principalPago * percentual) / 100);

  const vencidas: ParcelaVencidaAcerto[] = [];
  let futurasQtd = 0;
  let futurasValor = 0;
  for (const p of [...entrada.parcelasAbertas].sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))) {
    const dias = diasCalendarioEntre(p.dataVencimento, entrada.dataBase);
    if (dias < 0) {
      futurasQtd += 1;
      futurasValor += p.valorNominal;
      continue;
    }
    const encargo = Math.round(calcularEncargoAtraso(p.valorNominal, dias, entrada.taxaMultaPercent, entrada.taxaJurosMensalPercent));
    vencidas.push({ id: p.id, display: p.display, dataVencimento: p.dataVencimento, diasAtraso: dias, valorNominal: p.valorNominal, encargo, total: p.valorNominal + encargo });
  }
  const dividaVencida = vencidas.reduce((s, v) => s + v.valorNominal, 0);
  const encargosVencidos = vencidas.reduce((s, v) => s + v.encargo, 0);
  const dividaTotal = dividaVencida + encargosVencidos;
  const valorCompensado = Math.min(valorCredito, dividaTotal);

  return {
    dataBase: entrada.dataBase,
    percentualCredito: percentual,
    entradaPaga,
    parcelasPagas: entrada.parcelasPagas.length,
    principalParcelas,
    principalPago,
    valorCredito,
    vencidas,
    dividaVencida,
    encargosVencidos,
    dividaTotal,
    valorCompensado,
    valorADevolver: Math.max(0, valorCredito - dividaTotal),
    saldoRemanescente: Math.max(0, dividaTotal - valorCredito),
    futuras: { quantidade: futurasQtd, valorNominal: futurasValor },
  };
}
