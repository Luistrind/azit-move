import { StatusAcordo } from '../enums/status-acordo';

// Acordo — registro formal de renegociação (Doc 2 §4.14). É onde vive o histórico do acordo.
// Renegociação é novação: parcelas antigas viram RENEGOCIADA e o acordo gera um
// ItemContratado de origem RENEGOCIACAO com as parcelas novas. Valores em centavos.
export interface Acordo {
  id: string;
  contratoId: string;
  operadorId: string;
  dataCriacao: string;
  dataEfetivacao?: string | null;
  valorTotalRenegociado: number;
  valorEntrada: number;
  numeroParcelasNovas: number;
  valorParcelaNova: number;
  asaasChargeIdEntrada?: string | null;
  status: StatusAcordo;
  observacao?: string | null;
  createdAt: string;
  updatedAt: string;
}
