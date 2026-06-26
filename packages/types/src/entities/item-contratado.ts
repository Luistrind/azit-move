import {
  NaturezaProduto,
  Credor,
  StatusItemContratado,
  Periodicidade,
} from '../enums/contrato-credito';
import { OrigemItemContratado } from '../enums/origem-item-contratado';

// ItemContratado — produto da cesta do contrato (Doc 2 §4.9). Origem rastreável de cada
// cobrança. Origem RENEGOCIACAO = crédito gerado por um acordo (novação). Valores em centavos.
export interface ItemContratado {
  id: string;
  contratoId: string;
  descricao: string;
  natureza: NaturezaProduto;
  origem: OrigemItemContratado;
  acordoOrigemId?: string | null;
  credor: Credor;
  credorId?: string | null;
  valor: number;
  numeroParcelas?: number | null;
  periodicidade?: Periodicidade | null;
  dataInicio: string;
  dataFim?: string | null;
  status: StatusItemContratado;
  createdAt: string;
  updatedAt: string;
}
