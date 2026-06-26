import { ModeloInvestimento } from '../enums/modelo-investimento';
import { StatusContratoInvestimento } from '../enums/status-contrato-investimento';

// ContratoInvestimento — espelho do crédito, fluxo invertido (Doc 2 §4.6).
// O titular aporta e a Azit devolve com rendimento. Valores em centavos.
export interface ContratoInvestimento {
  id: string;
  numero: string;
  contaId: string;
  modelo: ModeloInvestimento;
  valorAportado: number;
  taxaRetorno?: number | null;
  dataAporte: string;
  dataInicio: string;
  dataVencimento?: string | null;
  capitalAmortizado: number;
  rendimentoAcumulado: number;
  status: StatusContratoInvestimento;
  createdAt: string;
  updatedAt: string;
}
