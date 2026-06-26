import {
  ContratoInvestimento,
  ModeloInvestimento as ModeloPrisma,
  StatusContratoInvestimento as StatusPrisma,
} from '@prisma/client';
import {
  ModeloInvestimento,
  StatusContratoInvestimento,
} from '@azit/types';
import { reaisParaCentavos } from '@azit/utils';

// Mapeamento na borda (enums lowercase; dinheiro em centavos; taxa fração; datas ISO).
const cent = (d: { toString(): string } | null): number =>
  d !== null ? reaisParaCentavos(d.toString()) : 0;

export function modeloParaPrisma(v: string): ModeloPrisma {
  const k = Object.entries(ModeloInvestimento).find(([, val]) => val === v)?.[0];
  if (!k) throw new Error(`modelo inválido: ${v}`);
  return k as ModeloPrisma;
}

export interface ContratoInvestimentoApi {
  id: string;
  numero: string;
  contaId: string;
  modelo: string;
  valorAportado: number;
  taxaRetorno: number | null;
  dataAporte: string;
  dataInicio: string;
  dataVencimento: string | null;
  capitalAmortizado: number;
  rendimentoAcumulado: number;
  status: string;
}

export function investimentoParaApi(c: ContratoInvestimento): ContratoInvestimentoApi {
  return {
    id: c.id,
    numero: c.numero,
    contaId: c.contaId,
    modelo: ModeloInvestimento[c.modelo],
    valorAportado: cent(c.valorAportado),
    taxaRetorno: c.taxaRetorno !== null ? Number(c.taxaRetorno.toString()) : null,
    dataAporte: c.dataAporte.toISOString(),
    dataInicio: c.dataInicio.toISOString(),
    dataVencimento: c.dataVencimento ? c.dataVencimento.toISOString() : null,
    capitalAmortizado: cent(c.capitalAmortizado),
    rendimentoAcumulado: cent(c.rendimentoAcumulado),
    status: StatusContratoInvestimento[c.status as StatusPrisma],
  };
}
