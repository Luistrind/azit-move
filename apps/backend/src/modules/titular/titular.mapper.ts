import { Titular, TipoPessoa, StatusTitular } from '@prisma/client';

// Mapeamento na borda (decisão de convenção): o banco/Prisma usa enums UPPERCASE,
// a API e @azit/types usam lowercase (api-spec §4.8). A tradução vive aqui, explícita.

const tipoPessoaParaApi: Record<TipoPessoa, 'pf' | 'pj'> = {
  PF: 'pf',
  PJ: 'pj',
};
const tipoPessoaParaPrisma: Record<'pf' | 'pj', TipoPessoa> = {
  pf: 'PF',
  pj: 'PJ',
};

const statusParaApi: Record<StatusTitular, 'ativo' | 'inativo' | 'bloqueado'> = {
  ATIVO: 'ativo',
  INATIVO: 'inativo',
  BLOQUEADO: 'bloqueado',
};
const statusParaPrisma: Record<'ativo' | 'inativo' | 'bloqueado', StatusTitular> =
  {
    ativo: 'ATIVO',
    inativo: 'INATIVO',
    bloqueado: 'BLOQUEADO',
  };

export const mapearTipoPessoa = {
  paraApi: (v: TipoPessoa) => tipoPessoaParaApi[v],
  paraPrisma: (v: 'pf' | 'pj') => tipoPessoaParaPrisma[v],
};

export const mapearStatusTitular = {
  paraApi: (v: StatusTitular) => statusParaApi[v],
  paraPrisma: (v: 'ativo' | 'inativo' | 'bloqueado') => statusParaPrisma[v],
};

// Representação do Titular exposta pela API (camelCase + enums lowercase + datas ISO).
export interface TitularApi {
  id: string;
  nome: string;
  tipoPessoa: 'pf' | 'pj';
  cpfCnpj: string;
  rg: string | null;
  estadoCivil: string | null;
  profissao: string | null;
  whatsapp: string;
  email: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  asaasCustomerId: string | null;
  status: 'ativo' | 'inativo' | 'bloqueado';
  createdAt: string;
  updatedAt: string;
}

export function titularParaApi(t: Titular): TitularApi {
  return {
    id: t.id,
    nome: t.nome,
    tipoPessoa: mapearTipoPessoa.paraApi(t.tipoPessoa),
    cpfCnpj: t.cpfCnpj,
    rg: t.rg,
    estadoCivil: t.estadoCivil,
    profissao: t.profissao,
    whatsapp: t.whatsapp,
    email: t.email,
    endereco: t.endereco,
    bairro: t.bairro,
    cidade: t.cidade,
    estado: t.estado,
    cep: t.cep,
    asaasCustomerId: t.asaasCustomerId,
    status: mapearStatusTitular.paraApi(t.status),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
