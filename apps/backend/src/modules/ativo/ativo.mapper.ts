import {
  Ativo,
  TipoAtivo,
  StatusAtivo,
  OrigemAtivo,
  TipoCombustivel,
} from '@prisma/client';
import { reaisParaCentavos, centavosParaReaisString } from '@azit/utils';

// Mapeamento na borda: enums Prisma UPPERCASE <-> API lowercase; dinheiro
// Decimal(reais) <-> centavos inteiros (convenção do money.ts / Regra 10).

type TipoApi = 'veiculo' | 'outro';
type StatusApi =
  | 'disponivel'
  | 'em_contrato'
  | 'quitado'
  | 'recuperado'
  | 'sinistrado';
type OrigemApi = 'locadora' | 'particular' | 'concessionaria';
type CombustivelApi = 'flex' | 'gasolina' | 'eletrico' | 'diesel' | 'hibrido';

const tipo = {
  paraApi: { VEICULO: 'veiculo', OUTRO: 'outro' } as Record<TipoAtivo, TipoApi>,
  paraPrisma: { veiculo: 'VEICULO', outro: 'OUTRO' } as Record<TipoApi, TipoAtivo>,
};

const status = {
  paraApi: {
    DISPONIVEL: 'disponivel',
    EM_CONTRATO: 'em_contrato',
    QUITADO: 'quitado',
    RECUPERADO: 'recuperado',
    SINISTRADO: 'sinistrado',
  } as Record<StatusAtivo, StatusApi>,
  paraPrisma: {
    disponivel: 'DISPONIVEL',
    em_contrato: 'EM_CONTRATO',
    quitado: 'QUITADO',
    recuperado: 'RECUPERADO',
    sinistrado: 'SINISTRADO',
  } as Record<StatusApi, StatusAtivo>,
};

const origem = {
  paraApi: {
    LOCADORA: 'locadora',
    PARTICULAR: 'particular',
    CONCESSIONARIA: 'concessionaria',
  } as Record<OrigemAtivo, OrigemApi>,
  paraPrisma: {
    locadora: 'LOCADORA',
    particular: 'PARTICULAR',
    concessionaria: 'CONCESSIONARIA',
  } as Record<OrigemApi, OrigemAtivo>,
};

const combustivel = {
  paraApi: {
    FLEX: 'flex',
    GASOLINA: 'gasolina',
    ELETRICO: 'eletrico',
    DIESEL: 'diesel',
    HIBRIDO: 'hibrido',
  } as Record<TipoCombustivel, CombustivelApi>,
  paraPrisma: {
    flex: 'FLEX',
    gasolina: 'GASOLINA',
    eletrico: 'ELETRICO',
    diesel: 'DIESEL',
    hibrido: 'HIBRIDO',
  } as Record<CombustivelApi, TipoCombustivel>,
};

export const mapearAtivoEnums = {
  tipoParaPrisma: (v: TipoApi) => tipo.paraPrisma[v],
  statusParaPrisma: (v: StatusApi) => status.paraPrisma[v],
  origemParaPrisma: (v: OrigemApi) => origem.paraPrisma[v],
  combustivelParaPrisma: (v: CombustivelApi) => combustivel.paraPrisma[v],
};

// Dinheiro na borda: centavos (API) <-> string de reais (Prisma Decimal).
export const valorAquisicaoParaPrisma = (centavos: number): string =>
  centavosParaReaisString(centavos);

export interface AtivoApi {
  id: string;
  tipo: TipoApi;
  descricao: string;
  marca: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  cor: string | null;
  placa: string | null;
  chassi: string | null;
  renavam: string | null;
  origem: OrigemApi | null;
  combustivel: CombustivelApi | null;
  quilometragemEntrada: number | null;
  valorAquisicao: number | null; // centavos
  status: StatusApi;
  createdAt: string;
  updatedAt: string;
}

export function ativoParaApi(a: Ativo): AtivoApi {
  return {
    id: a.id,
    tipo: tipo.paraApi[a.tipo],
    descricao: a.descricao,
    marca: a.marca,
    modelo: a.modelo,
    anoFabricacao: a.anoFabricacao,
    anoModelo: a.anoModelo,
    cor: a.cor,
    placa: a.placa,
    chassi: a.chassi,
    renavam: a.renavam,
    origem: a.origem ? origem.paraApi[a.origem] : null,
    combustivel: a.combustivel ? combustivel.paraApi[a.combustivel] : null,
    quilometragemEntrada: a.quilometragemEntrada,
    valorAquisicao:
      a.valorAquisicao !== null
        ? reaisParaCentavos(a.valorAquisicao.toString())
        : null,
    status: status.paraApi[a.status],
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
