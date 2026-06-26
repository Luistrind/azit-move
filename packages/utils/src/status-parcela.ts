import { startOfDay, isSameDay, isAfter } from 'date-fns';
import { StatusParcela } from '@azit/types';

// Resolve o status de uma parcela em runtime (Doc 5 §11.2).
// Se `status` está armazenado (Paga, Renegociada, etc.), retorna-o.
// Se é null, deriva da data: Vence hoje / Vencida / Em aberto.
// Vive aqui para ser compartilhada entre backend e frontend (Regra 7 do CLAUDE.md:
// status calculados não são gravados).
export function resolverStatusParcela(parcela: {
  status: StatusParcela | null;
  dataVencimento: Date | string;
}): StatusParcela {
  if (parcela.status) return parcela.status;

  const hoje = startOfDay(new Date());
  const venc = startOfDay(new Date(parcela.dataVencimento));

  if (isSameDay(hoje, venc)) return StatusParcela.VENCE_HOJE;
  if (isAfter(hoje, venc)) return StatusParcela.VENCIDA;
  return StatusParcela.EM_ABERTO;
}
