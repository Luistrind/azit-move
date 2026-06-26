import { StatusFatura } from '../enums/status-fatura';
import { Credor, TipoItemFatura } from '../enums/contrato-credito';

// Fatura — cobrança semanal que agrega itens vencidos de todos os contratos da conta
// (Doc 2 §4.11). É o agregador; o contrato é a origem. Valores em centavos.
export interface Fatura {
  id: string;
  contaId: string;
  numero: number;
  periodoReferencia: string;
  dataFechamento: string;
  dataVencimento: string;
  dataPagamento?: string | null;
  valorTotal: number;
  valorPago?: number | null;
  status: StatusFatura;
  asaasChargeId?: string | null;
  acordoId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemFatura {
  id: string;
  faturaId: string;
  parcelaId: string;
  tipo: TipoItemFatura;
  descricao: string;
  valor: number;
  credor: Credor;
  credorId?: string | null;
}
