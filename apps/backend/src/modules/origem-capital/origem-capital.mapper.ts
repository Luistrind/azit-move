import {
  OrigemCapital,
  TipoOrigemCapital,
  StatusOrigemCapital,
} from '@prisma/client';
import { reaisParaCentavos, centavosParaReaisString } from '@azit/utils';

// Mapeamento na borda. Dinheiro (valorAportado) em centavos <-> Decimal reais.
// taxaRetorno é uma TAXA (fração decimal, ex 0.033), não dinheiro: number direto.

type TipoApi = 'capital_proprio' | 'emprestimo' | 'investidor_ativo' | 'fundo';
type StatusApi = 'ativo' | 'encerrado';

const tipo = {
  paraApi: {
    CAPITAL_PROPRIO: 'capital_proprio',
    EMPRESTIMO: 'emprestimo',
    INVESTIDOR_ATIVO: 'investidor_ativo',
    FUNDO: 'fundo',
  } as Record<TipoOrigemCapital, TipoApi>,
  paraPrisma: {
    capital_proprio: 'CAPITAL_PROPRIO',
    emprestimo: 'EMPRESTIMO',
    investidor_ativo: 'INVESTIDOR_ATIVO',
    fundo: 'FUNDO',
  } as Record<TipoApi, TipoOrigemCapital>,
};

const status = {
  paraApi: { ATIVO: 'ativo', ENCERRADO: 'encerrado' } as Record<
    StatusOrigemCapital,
    StatusApi
  >,
  paraPrisma: { ativo: 'ATIVO', encerrado: 'ENCERRADO' } as Record<
    StatusApi,
    StatusOrigemCapital
  >,
};

export const mapearOrigemCapitalEnums = {
  tipoParaPrisma: (v: TipoApi) => tipo.paraPrisma[v],
  statusParaPrisma: (v: StatusApi) => status.paraPrisma[v],
};

export const valorAportadoParaPrisma = (centavos: number): string =>
  centavosParaReaisString(centavos);

export interface OrigemCapitalApi {
  id: string;
  ativoId: string;
  tipo: TipoApi;
  contratoInvestimentoId: string | null;
  valorAportado: number; // centavos
  taxaRetorno: number | null; // fração decimal (0.033 = 3,3%)
  dataAporte: string;
  status: StatusApi;
  createdAt: string;
  updatedAt: string;
}

export function origemCapitalParaApi(o: OrigemCapital): OrigemCapitalApi {
  return {
    id: o.id,
    ativoId: o.ativoId,
    tipo: tipo.paraApi[o.tipo],
    contratoInvestimentoId: o.contratoInvestimentoId,
    valorAportado: reaisParaCentavos(o.valorAportado.toString()),
    taxaRetorno: o.taxaRetorno !== null ? Number(o.taxaRetorno.toString()) : null,
    dataAporte: o.dataAporte.toISOString(),
    status: status.paraApi[o.status],
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
