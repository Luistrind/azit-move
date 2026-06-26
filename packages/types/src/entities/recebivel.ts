import { StatusRecebivel } from '../enums/contrato-credito';

// Recebível — direito financeiro do contrato (Doc 2 §4.13). Nasce no dia zero (esperado);
// vira realizado ao pagar. O breakdown é PLACEHOLDER (fórmula pendente — Sebastião/fundo).
// Valores em centavos.
export interface Recebivel {
  id: string;
  contratoId: string;
  parcelaId: string;
  origemCapitalId: string;
  dataPrevista: string;
  valorPrevisto: number;
  dataRealizada?: string | null;
  valorRealizado?: number | null;
  status: StatusRecebivel;
  // PLACEHOLDER — não calcular até a fórmula do fundo ser definida (Doc 2 §12).
  breakdownCapital?: number | null;
  breakdownRendimento?: number | null;
  breakdownTaxaServico?: number | null;
  createdAt: string;
  updatedAt: string;
}
