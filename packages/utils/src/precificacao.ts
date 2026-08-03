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
  // PRECIFICAÇÃO (reunião 11/07): parcela exibida divide por 4 / 2 (números comerciais).
  fatorPrecificacaoSemanal: number; // 4
  fatorPrecificacaoQuinzenal: number; // 2
  // CONTRATO (parametrização): nº exato de parcelas usa semanas/mês reais.
  fatorSemanal: number; // 4.345
  fatorQuinzenal: number; // 2.1725
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
  const fatorPrec =
    p.frequencia === 'mensal'
      ? 1
      : p.frequencia === 'quinzenal'
        ? p.fatorPrecificacaoQuinzenal
        : p.fatorPrecificacaoSemanal;
  const fatorContrato =
    p.frequencia === 'mensal' ? 1 : p.frequencia === 'quinzenal' ? p.fatorQuinzenal : p.fatorSemanal;
  return {
    valorParcelamento: vp,
    parcelaMensalBase: Math.round(pm1),
    parcelaMensalTotal: Math.round(pmt),
    parcelaFinal: Math.round(pmt / fatorPrec),
    numeroParcelas: Math.max(1, Math.round(pc * fatorContrato)),
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

// ============================================================
// ANTECIPAÇÃO DE PARCELA (planilha do Vicente, 11/07/2026): cada parcela em
// aberto separa em CR (comissão) e PS (capital + remuneração). Valor presente
// com taxa DIÁRIA equivalente à mensal: VP = VF / (1+d)^dias, d = (1+tm)^(1/30)−1.
// CR desconta forte (20% a.m. — "isenção" prática do serviço distante); PS
// desconta na TR do contrato (a mesma da precificação).
// ============================================================
export function valorPresenteMensal(vf: number, taxaMensal: number, dias: number): number {
  if (dias <= 0 || taxaMensal <= 0) return vf;
  const d = Math.pow(1 + taxaMensal, 1 / 30) - 1;
  return vf / Math.pow(1 + d, dias);
}

export function anteciparParcela(p: {
  valorNominal: number; // centavos
  componenteCR: number; // centavos (comissão embutida na parcela)
  dias: number; // até o vencimento
  taxaDescontoCR: number; // fração a.m. (ex: 0.20)
  taxaDescontoPS: number; // fração a.m. (TR do contrato)
}): { valorPresente: number; crHoje: number; psHoje: number } {
  const cr = Math.min(Math.max(0, p.componenteCR), p.valorNominal);
  const ps = p.valorNominal - cr;
  const crHoje = valorPresenteMensal(cr, p.taxaDescontoCR, p.dias);
  const psHoje = valorPresenteMensal(ps, p.taxaDescontoPS, p.dias);
  return { valorPresente: Math.round(crHoje + psHoje), crHoje: Math.round(crHoje), psHoje: Math.round(psHoje) };
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

// ============================================================
// REEMBOLSO PARCELADO (Catálogo F3 — Requisitos v0.3 §4)
//   TP  = max(VR × taxaInicialPct, taxaInicialMinima)  — entra no financiado
//   VF  = VR + TP
//   i_p = (1 + encargoMensal)^(dias ÷ 30) − 1  (equivalência financeira —
//         NUNCA dividir a parcela mensal pelo índice de valor; regra da planilha)
//   parcela = Price(VF, i_p, n); resíduo de arredondamento na ÚLTIMA parcela
//   (o cronograma do núcleo já absorve o resíduo na última — RF-RP05)
// ============================================================

export type FrequenciaReembolso = 'mensal' | 'quinzenal' | 'semanal';

const DIAS_INTERVALO: Record<FrequenciaReembolso, number> = {
  mensal: 30,
  quinzenal: 14,
  semanal: 7,
};

export interface ParametrosReembolso {
  valorReembolso: number; // centavos (VR)
  numeroParcelas: number;
  frequencia: FrequenciaReembolso;
  encargoMensal: number; // fração a.m. (ex.: 0.1999)
  taxaInicialPct: number; // fração (ex.: 0.0999)
  taxaInicialMinima: number; // centavos (ex.: 9990)
}

export interface ResultadoReembolso {
  taxaInicial: number; // centavos (TP)
  valorFinanciado: number; // centavos (VF = VR + TP)
  taxaPeriodo: number; // fração por período
  valorParcela: number; // centavos
  totalAPagar: number; // centavos (parcela × n)
}

export function precificarReembolsoParcelado(p: ParametrosReembolso): ResultadoReembolso {
  if (!Number.isInteger(p.numeroParcelas) || p.numeroParcelas < 1) {
    throw new Error('numeroParcelas deve ser inteiro >= 1');
  }
  const taxaInicial = Math.max(Math.round(p.valorReembolso * p.taxaInicialPct), p.taxaInicialMinima);
  const vf = p.valorReembolso + taxaInicial;
  const dias = DIAS_INTERVALO[p.frequencia];
  const i = Math.pow(1 + p.encargoMensal, dias / 30) - 1;
  const n = p.numeroParcelas;
  const pmt = i === 0 ? vf / n : (vf * (i * Math.pow(1 + i, n))) / (Math.pow(1 + i, n) - 1);
  const valorParcela = Math.round(pmt);
  return {
    taxaInicial,
    valorFinanciado: vf,
    taxaPeriodo: i,
    valorParcela,
    totalAPagar: valorParcela * n,
  };
}

// ============================================================
// ANTECIPAÇÃO POR COMPONENTE (Catálogo F4 — Requisitos v0.3 §7)
//   Cada parcela separa em BEM (capital+remuneração), COMISSÃO e PROTEÇÃO.
//   VP de cada componente = valor ÷ (1 + taxa_diária)^dias, com
//   taxa_diária = (1 + taxaMensal)^(1/30) − 1. Taxa 0 → componente CHEIO.
//   LIQUIDAÇÃO TOTAL: comissão e proteção futuras podem ser ISENTAS (flags da
//   versão do produto). Antecipação PARCIAL: cobra comissão e proteção cheias.
// ============================================================

export interface ParametrosAntecipacaoComponentes {
  valorNominal: number; // centavos — parcela total
  componenteComissao: number; // centavos
  componenteProtecao: number; // centavos
  dias: number; // até o vencimento (>= 0)
  taxaDescontoBem: number; // fração a.m. (TRD da variante)
  taxaDescontoComissao: number; // fração a.m. (0 = sem desconto, cobra cheia)
  taxaDescontoProtecao: number; // fração a.m. (0 = sem desconto, cobra cheia)
  isentarComissao: boolean; // true só na liquidação total (flag da versão)
  isentarProtecao: boolean;
}

export interface ResultadoAntecipacaoComponentes {
  valorPresente: number; // centavos
  bemNominal: number;
  bemPresente: number;
  comissaoCobrada: number; // 0 quando isenta
  protecaoCobrada: number; // 0 quando isenta
}

function vpDiario(valor: number, taxaMensal: number, dias: number): number {
  if (valor <= 0) return 0;
  if (taxaMensal <= 0 || dias <= 0) return valor;
  const d = Math.pow(1 + taxaMensal, 1 / 30) - 1;
  return valor / Math.pow(1 + d, dias);
}

export function anteciparParcelaComponentes(
  p: ParametrosAntecipacaoComponentes,
): ResultadoAntecipacaoComponentes {
  const bemNominal = Math.max(0, p.valorNominal - p.componenteComissao - p.componenteProtecao);
  const bemPresente = Math.round(vpDiario(bemNominal, p.taxaDescontoBem, p.dias));
  const comissaoCobrada = p.isentarComissao
    ? 0
    : Math.round(vpDiario(p.componenteComissao, p.taxaDescontoComissao, p.dias));
  const protecaoCobrada = p.isentarProtecao
    ? 0
    : Math.round(vpDiario(p.componenteProtecao, p.taxaDescontoProtecao, p.dias));
  return {
    valorPresente: bemPresente + comissaoCobrada + protecaoCobrada,
    bemNominal,
    bemPresente,
    comissaoCobrada,
    protecaoCobrada,
  };
}

// ============================================================
// PROTEÇÃO VEICULAR (Catálogo F5 — Requisitos v0.3 §5)
//   Contribuição mensal = MÁX(contribuição mínima da variante; FIPE × taxa da
//   oferta) + administração + assistência + acréscimo por perfil (RF-PV01).
//   Conversão para o período pelo índice de conversão de valor (planilha):
//   semanal ÷4, quinzenal ÷2. ⚠️ Valores do catálogo em HOMOLOGAÇÃO (pergunta 2).
// ============================================================

export interface ParametrosProtecao {
  fipe: number; // centavos
  contribuicaoMinimaMensal: number; // centavos (variante)
  taxaFipeMensal: number; // fração (oferta)
  taxaAdministracaoMensal: number; // centavos
  custoAssistenciaMensal: number; // centavos (oferta)
  acrescimoPerfilMensal: number; // centavos
  frequencia: 'mensal' | 'quinzenal' | 'semanal';
}

export interface ResultadoProtecao {
  baseFipe: number; // centavos — FIPE × taxa
  contribuicaoMensal: number; // centavos
  contribuicaoPeriodo: number; // centavos, na frequência pedida
}

export function contribuicaoProtecaoVeicular(p: ParametrosProtecao): ResultadoProtecao {
  const baseFipe = Math.round(p.fipe * p.taxaFipeMensal);
  const contribuicaoMensal =
    Math.max(p.contribuicaoMinimaMensal, baseFipe) +
    p.taxaAdministracaoMensal +
    p.custoAssistenciaMensal +
    p.acrescimoPerfilMensal;
  const divisor = p.frequencia === 'semanal' ? 4 : p.frequencia === 'quinzenal' ? 2 : 1;
  return {
    baseFipe,
    contribuicaoMensal,
    contribuicaoPeriodo: Math.round(contribuicaoMensal / divisor),
  };
}
