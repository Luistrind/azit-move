import { StatusParcela } from '@azit/types';
import { dataCalendarioUTC, dataHojeBrasil } from './datas';

// Resolve o status de uma parcela em runtime (Doc 5 §11.2).
// Se `status` está armazenado (Paga, Renegociada, etc.), retorna-o.
// Se é null, deriva da data: Vence hoje / Vencida / Em aberto.
// Vive aqui para ser compartilhada entre backend e frontend (Regra 7 do CLAUDE.md:
// status calculados não são gravados).
// Compara DIAS DE CALENDÁRIO: o vencimento é coluna de data (dia gravado em
// UTC) e "hoje" é o do fuso do negócio (Regra 15) — nem o relógio do servidor
// (UTC) nem o do navegador.
export function resolverStatusParcela(parcela: {
  status: StatusParcela | null;
  dataVencimento: Date | string;
  hoje?: string; // 'YYYY-MM-DD' — injetável em testes
}): StatusParcela {
  if (parcela.status) return parcela.status;

  const hoje = parcela.hoje ?? dataHojeBrasil();
  const venc = dataCalendarioUTC(new Date(parcela.dataVencimento));

  if (venc === hoje) return StatusParcela.VENCE_HOJE;
  if (venc < hoje) return StatusParcela.VENCIDA;
  return StatusParcela.EM_ABERTO;
}
