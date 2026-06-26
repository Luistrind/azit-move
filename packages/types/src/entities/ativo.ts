import {
  TipoAtivo,
  StatusAtivo,
  TipoCombustivel,
  OrigemAtivo,
} from '../enums/ativo';

// Ativo — o bem objeto do contrato (Doc 2 §4.4). Valores monetários em centavos.
export interface Ativo {
  id: string;
  tipo: TipoAtivo;
  descricao: string;
  marca?: string | null;
  modelo?: string | null;
  anoFabricacao?: number | null;
  anoModelo?: number | null;
  cor?: string | null;
  placa?: string | null;
  chassi?: string | null;
  renavam?: string | null;
  origem?: OrigemAtivo | null;
  combustivel?: TipoCombustivel | null;
  quilometragemEntrada?: number | null;
  valorAquisicao?: number | null;
  status: StatusAtivo;
  createdAt: string;
  updatedAt: string;
}
