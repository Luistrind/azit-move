// ============================================================
// TIPO do ContratoCredito — função ÚNICA de classificação (Regra 16; decisão
// Luís 29/10/2026, doc 02 §5.2 "KPIs da carteira por conta e por tipo").
//
// O ContratoCredito não tem coluna `tipo`: o que ele É se deduz do que carrega.
// Esta é a única casa dessa dedução — KPIs da Carteira, posição por titular e
// qualquer tela que precise separar "contrato de veículo" de "reembolso"
// chamam `classificarContrato`, nunca repetem os critérios.
//
// Critérios, na ordem:
//   1. termo de novação  → `termoDeNovacao` (Novacao.contratoTermoId aponta para
//      ele; só o service conhece a relação). Fase do Termo (doc 02 §7.7b).
//   2. reembolso         → qualquer marca de Reembolso Parcelado:
//        · `snapshotJson.legado.reembolsoDe` (migração do legado, §26.8) ou
//          numero com sufixo "-RPn" (mesma origem; backfill 16/10);
//        · `aprovadoComoReembolso` (originação nativa: Aprovacao com
//          tipoOperacao 'reembolso_parcelado' referenciando o contrato — §18.5).
//   3. veiculo           → tem Ativo e o ativo é do tipo VEICULO (carro, moto…;
//      a varianteCatalogo NÃO entra: 'outro' continua veículo se o tipo diz).
//   4. credito           → o resto: crédito avulso sem ativo (doc 02 §4.7-A) ou
//      com ativo sintético OUTRO (forma antiga, anterior a 12/09).
//
// Se um dia nascer um tipo que estes critérios não separam, a decisão de
// modelagem (coluna `tipo` + backfill) sobe ao doc 02 ANTES de mexer aqui.
// ============================================================

export type TipoContrato = 'veiculo' | 'reembolso' | 'credito' | 'termo_novacao';

export const TIPO_CONTRATO_LABEL: Record<TipoContrato, string> = {
  veiculo: 'Veículo',
  reembolso: 'Reembolso Parcelado',
  credito: 'Crédito avulso',
  termo_novacao: 'Termo de novação',
};

export interface ContratoClassificavel {
  numero: string;
  // Prisma devolve 'VEICULO' | 'OUTRO'; a API, minúsculo — os dois valem.
  ativo?: { tipo: string } | null;
  snapshotJson?: unknown;
  // Marcas que vivem em OUTRAS tabelas — o service carrega e informa.
  aprovadoComoReembolso?: boolean;
  termoDeNovacao?: boolean;
}

const SUFIXO_RP = /-RP\d+$/i;

function reembolsoDoLegado(snapshotJson: unknown): boolean {
  if (!snapshotJson || typeof snapshotJson !== 'object') return false;
  const legado = (snapshotJson as { legado?: unknown }).legado;
  if (!legado || typeof legado !== 'object') return false;
  const de = (legado as { reembolsoDe?: unknown }).reembolsoDe;
  return typeof de === 'string' && de.length > 0;
}

export function classificarContrato(c: ContratoClassificavel): TipoContrato {
  if (c.termoDeNovacao) return 'termo_novacao';
  if (c.aprovadoComoReembolso || reembolsoDoLegado(c.snapshotJson) || SUFIXO_RP.test(c.numero)) return 'reembolso';
  if (c.ativo && String(c.ativo.tipo).toUpperCase() === 'VEICULO') return 'veiculo';
  return 'credito';
}

// Contagem por tipo a partir de uma lista já classificada — zera os ausentes
// para a tela não ter de tratar `undefined`.
export function contarPorTipo(tipos: Iterable<TipoContrato>): Record<TipoContrato, number> {
  const r: Record<TipoContrato, number> = { veiculo: 0, reembolso: 0, credito: 0, termo_novacao: 0 };
  for (const t of tipos) r[t] += 1;
  return r;
}

// Em que FATIA da carteira sob gestão cai uma parcela em aberto (doc 02 §5.2,
// 29/10): cota de acordo (item de origem ACORDO) e Termo de novação são dívida
// renegociada → 'acordos'; reembolso e crédito avulso → 'reembolsos'; o resto
// é a parcela do veículo. A origem do item vem em maiúsculo (Prisma) ou
// minúsculo (API).
export type FatiaCarteira = 'veiculo' | 'acordos' | 'reembolsos';

export function fatiaDaCarteira(tipoContrato: TipoContrato, origemItem: string): FatiaCarteira {
  if (String(origemItem).toUpperCase() === 'ACORDO' || tipoContrato === 'termo_novacao') return 'acordos';
  if (tipoContrato === 'reembolso' || tipoContrato === 'credito') return 'reembolsos';
  return 'veiculo';
}
