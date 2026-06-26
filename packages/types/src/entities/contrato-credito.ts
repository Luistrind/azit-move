import { Periodicidade, MotivoEncerramento } from '../enums/contrato-credito';
import { StatusContratoCredito } from '../enums/status-contrato-credito';

// ContratoCredito — produto de crédito vendido ao titular (Doc 2 §4.7). O titular DEVE.
// Valores monetários em centavos; taxas em fração decimal (ex: 0.033 = 3,3% ao dia).
export interface ContratoCredito {
  id: string;
  numero: string;
  contaId: string;
  ativoId: string;
  pophubId?: string | null;
  dataAssinatura: string;
  dataPrimeiraParcela: string;
  valorTotal: number;
  valorEntrada: number;
  saldoDevedor: number;
  numeroParcelas: number;
  valorParcelaInicial: number;
  periodicidade: Periodicidade;
  indiceReajuste?: string | null;
  taxaMultaAtraso: number;
  taxaJurosAtraso: number;
  taxaDescontoQuitacao?: number | null;
  status: StatusContratoCredito;
  dataEncerramento?: string | null;
  motivoEncerramento?: MotivoEncerramento | null;
  asaasSubscriptionId?: string | null;
  createdAt: string;
  updatedAt: string;
}
