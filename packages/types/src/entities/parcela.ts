import { StatusParcela } from '../enums/status-parcela';

// Parcela — unidade do cronograma (Doc 2 §4.10). Nasce no dia zero.
// status null = em aberto/vence hoje/vencida (calculado em runtime pela data).
// acordoId só nas parcelas ANTIGAS extintas por um acordo (status RENEGOCIADA).
// Valores em centavos.
export interface Parcela {
  id: string;
  contratoId: string;
  itemContratadoId: string;
  numero: number;
  totalParcelas: number;
  display: string;
  valorNominal: number;
  dataVencimento: string;
  dataPagamento?: string | null;
  valorPago?: number | null;
  valorEncargo?: number | null;
  status: StatusParcela | null;
  faturaId?: string | null;
  acordoId?: string | null;
  createdAt: string;
  updatedAt: string;
}
