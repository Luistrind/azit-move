import { TipoOrigemCapital, StatusOrigemCapital } from '../enums/origem-capital';

// OrigemCapital — como o ativo foi financiado (Doc 2 §4.5). Elo entre o capital que
// entra (lado investimento) e o ativo que ele financia (lado crédito). Valores em centavos.
export interface OrigemCapital {
  id: string;
  ativoId: string;
  tipo: TipoOrigemCapital;
  contratoInvestimentoId?: string | null;
  valorAportado: number;
  taxaRetorno?: number | null;
  dataAporte: string;
  status: StatusOrigemCapital;
  createdAt: string;
  updatedAt: string;
}
