// Precificação da oferta (Doc 7 item 7.4 / Doc 2 §4-A.2). Função PURA — centavos.
//
// ⚠️ PROVISÓRIA — SUBSTITUIR (Vicente). A fórmula definitiva ainda não foi
// fechada. Usamos a Tabela Price (sistema francês) com taxa de 0,5%/semana
// PARAMETRIZÁVEL como padrão funcional, para o funil simular de ponta a ponta.
// Está isolada aqui de propósito: trocar a regra é trocar esta função, sem
// mexer na estrutura do funil. Coberta por teste.
//
// Parte do VALOR DE VENDA do ativo individual (não de produto-catálogo) — a
// direção definitiva do domínio. valorFinanciado = valorVenda - entrada.

// ⚠️ ZERADA PARA TESTE (a pedido). Padrão provisório era 0,005 (0,5% a.s.).
// Com taxa 0, a parcela = financiado / n (sem juros). Reverter/definir com Vicente.
export const TAXA_SEMANAL_PROVISORIA = 0; // placeholder — atualmente sem juros

export interface ParametrosPrecificacao {
  valorVenda: number; // centavos — preço de venda do ativo
  valorEntrada: number; // centavos
  prazoSemanas: number; // nº de parcelas (períodos)
  taxaSemanal?: number; // fração por semana; default TAXA_SEMANAL_PROVISORIA
}

export interface ResultadoPrecificacao {
  valorFinanciado: number; // centavos (valorVenda - entrada)
  valorParcela: number; // centavos (parcela constante, Price)
  numeroParcelas: number;
  totalParcelado: number; // centavos (valorParcela * n)
  totalAPagar: number; // centavos (entrada + totalParcelado)
  taxaSemanal: number; // taxa efetivamente usada
  provisorio: true; // marca que o número saiu de regra placeholder
}

// ============================================================
// SIMULAÇÃO V3 (Doc 2 §4-A.2, Decisão 2026-07-05) — memória de cálculo da
// planilha do Vicente. Função PURA, centavos. Os parâmetros (CI, CR, TR,
// fatores) vêm da VersaoParametrosSimulacao vigente — nada hardcoded.
//   VP  = VA + CI − EN
//   PM1 = VP × [TR×(1+TR)^PC] / [(1+TR)^PC − 1]   (Price mensal)
//   PMT = PM1 + CR
//   PF  = PMT (mensal) | PMT ÷ fatorQuinzenal | PMT ÷ fatorSemanal
//   n   = round(PC × fator)  — última parcela absorve o resíduo no cronograma
// ============================================================

export type FrequenciaSimulacao = 'mensal' | 'quinzenal' | 'semanal';

export interface ParametrosSimulacaoV3 {
  valorAvista: number; // centavos (VA)
  valorEntrada: number; // centavos (EN)
  prazoMeses: number; // PC
  frequencia: FrequenciaSimulacao;
  comissaoInicial: number; // centavos (CI)
  comissaoRecorrente: number; // centavos (CR)
  taxaMensal: number; // fração a.m. (TR, ex: 0.02)
  fatorSemanal: number; // semanas/mês (4.345)
  fatorQuinzenal: number; // quinzenas/mês (2.1725)
}

export interface ResultadoSimulacaoV3 {
  valorParcelamento: number; // VP centavos
  parcelaMensalBase: number; // PM1 centavos
  parcelaMensalTotal: number; // PMT centavos
  parcelaFinal: number; // PF centavos, conforme frequência
  numeroParcelas: number; // round(PC × fator)
  totalAPagar: number; // entrada + PMT × PC (total do plano mensal)
}

export function precificarSimulacao(p: ParametrosSimulacaoV3): ResultadoSimulacaoV3 {
  if (!Number.isInteger(p.prazoMeses) || p.prazoMeses < 1) {
    throw new Error('prazoMeses deve ser inteiro >= 1');
  }
  const vp = Math.max(0, p.valorAvista + p.comissaoInicial - p.valorEntrada);
  const i = p.taxaMensal;
  const pc = p.prazoMeses;
  const pm1 =
    vp === 0 ? 0 : i === 0 ? vp / pc : (vp * (i * Math.pow(1 + i, pc))) / (Math.pow(1 + i, pc) - 1);
  const pmt = pm1 + p.comissaoRecorrente;
  const fator =
    p.frequencia === 'mensal' ? 1 : p.frequencia === 'quinzenal' ? p.fatorQuinzenal : p.fatorSemanal;
  return {
    valorParcelamento: vp,
    parcelaMensalBase: Math.round(pm1),
    parcelaMensalTotal: Math.round(pmt),
    parcelaFinal: Math.round(pmt / fator),
    numeroParcelas: Math.max(1, Math.round(pc * fator)),
    totalAPagar: p.valorEntrada + Math.round(pmt * pc),
  };
}

// Crédito avulso com a taxa vigente: Price na taxa periódica EQUIVALENTE à TR
// mensal — i_p = (1+TR)^(1/fator) − 1 (fator = períodos por mês). Provisório
// até o Vicente formalizar a régua do crédito avulso.
export function precificarCreditoAvulso(p: {
  valorFinanciado: number; // centavos
  numeroParcelas: number;
  taxaMensal: number;
  fator: number; // 1 mensal | fatorQuinzenal | fatorSemanal
}): { valorParcela: number } {
  if (p.valorFinanciado <= 0 || p.numeroParcelas < 1) return { valorParcela: 0 };
  const ip = p.taxaMensal === 0 ? 0 : Math.pow(1 + p.taxaMensal, 1 / p.fator) - 1;
  const pmt =
    ip === 0
      ? p.valorFinanciado / p.numeroParcelas
      : (p.valorFinanciado * ip) / (1 - Math.pow(1 + ip, -p.numeroParcelas));
  return { valorParcela: Math.round(pmt) };
}

// PMT da Tabela Price: PV * i / (1 - (1+i)^-n). Para i=0, PMT = PV/n.
export function precificarPrice(p: ParametrosPrecificacao): ResultadoPrecificacao {
  const i = p.taxaSemanal ?? TAXA_SEMANAL_PROVISORIA;
  const n = p.prazoSemanas;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('prazoSemanas deve ser inteiro >= 1');
  }
  const valorFinanciado = Math.max(0, p.valorVenda - p.valorEntrada);
  const pmt =
    i === 0
      ? valorFinanciado / n
      : (valorFinanciado * i) / (1 - Math.pow(1 + i, -n));
  const valorParcela = Math.round(pmt);
  const totalParcelado = valorParcela * n;
  return {
    valorFinanciado,
    valorParcela,
    numeroParcelas: n,
    totalParcelado,
    totalAPagar: p.valorEntrada + totalParcelado,
    taxaSemanal: i,
    provisorio: true,
  };
}
