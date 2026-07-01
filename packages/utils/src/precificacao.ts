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
