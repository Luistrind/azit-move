import { StatusConta } from '../enums/titular';

// Conta — relacionamento financeiro do titular (Doc 2 §4.3). Não tem "tipo":
// agrega contratos de crédito (deve) e de investimento (a receber) na mesma conta.
export interface Conta {
  id: string;
  titularId: string;
  dataAbertura: string;
  status: StatusConta;
  createdAt: string;
  updatedAt: string;
}
