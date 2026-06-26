import { Conta, StatusConta } from '@prisma/client';

// Mapeamento na borda (Prisma UPPERCASE <-> API lowercase). Ver convenção do Titular.

const statusParaApi: Record<StatusConta, 'ativa' | 'suspensa' | 'encerrada'> = {
  ATIVA: 'ativa',
  SUSPENSA: 'suspensa',
  ENCERRADA: 'encerrada',
};
const statusParaPrisma: Record<'ativa' | 'suspensa' | 'encerrada', StatusConta> =
  {
    ativa: 'ATIVA',
    suspensa: 'SUSPENSA',
    encerrada: 'ENCERRADA',
  };

export const mapearStatusConta = {
  paraApi: (v: StatusConta) => statusParaApi[v],
  paraPrisma: (v: 'ativa' | 'suspensa' | 'encerrada') => statusParaPrisma[v],
};

export interface ContaApi {
  id: string;
  titularId: string;
  dataAbertura: string;
  status: 'ativa' | 'suspensa' | 'encerrada';
  createdAt: string;
  updatedAt: string;
}

export function contaParaApi(c: Conta): ContaApi {
  return {
    id: c.id,
    titularId: c.titularId,
    dataAbertura: c.dataAbertura.toISOString(),
    status: mapearStatusConta.paraApi(c.status),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
