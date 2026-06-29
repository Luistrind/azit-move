import {
  ContratoCredito,
  ItemContratado,
  Parcela,
  Periodicidade as PeriodicidadePrisma,
  StatusParcela as StatusParcelaPrisma,
} from '@prisma/client';
import {
  StatusContratoCredito,
  MotivoEncerramento,
  Periodicidade,
  NaturezaProduto,
  OrigemItemContratado,
  Credor,
  StatusItemContratado,
  StatusParcela,
} from '@azit/types';
import { resolverStatusParcela, reaisParaCentavos } from '@azit/utils';

// Mapeamento na borda. Para enums cujas CHAVES em @azit/types == valores do Prisma,
// indexa-se o enum diretamente pelo valor Prisma (paraApi). Datas em ISO; dinheiro
// em centavos; taxas (%/fração) como number.

const dec = (d: { toString(): string } | null): number | null =>
  d !== null ? reaisParaCentavos(d.toString()) : null;
const taxa = (d: { toString(): string } | null): number | null =>
  d !== null ? Number(d.toString()) : null;

// Reverte um valor de API (rótulo/lowercase) para a chave do enum Prisma.
export function chavePrisma<T extends Record<string, string>>(
  enumObj: T,
  valorApi: string,
): keyof T {
  const entrada = Object.entries(enumObj).find(([, v]) => v === valorApi);
  if (!entrada) throw new Error(`valor inválido para enum: ${valorApi}`);
  return entrada[0] as keyof T;
}

export interface ContratoApi {
  id: string;
  numero: string;
  contaId: string;
  ativoId: string;
  dataAssinatura: string;
  dataPrimeiraParcela: string;
  valorTotal: number;
  valorEntrada: number;
  saldoDevedor: number;
  numeroParcelas: number;
  valorParcelaInicial: number;
  periodicidade: string;
  indiceReajuste: string | null;
  taxaMultaAtraso: number | null;
  taxaJurosAtraso: number | null;
  taxaDescontoQuitacao: number | null;
  status: string;
  dataEncerramento: string | null;
  motivoEncerramento: string | null;
  createdAt: string;
  updatedAt: string;
}

export function contratoParaApi(c: ContratoCredito): ContratoApi {
  return {
    id: c.id,
    numero: c.numero,
    contaId: c.contaId,
    ativoId: c.ativoId,
    dataAssinatura: c.dataAssinatura.toISOString(),
    dataPrimeiraParcela: c.dataPrimeiraParcela.toISOString(),
    valorTotal: dec(c.valorTotal)!,
    valorEntrada: dec(c.valorEntrada)!,
    saldoDevedor: dec(c.saldoDevedor)!,
    numeroParcelas: c.numeroParcelas,
    valorParcelaInicial: dec(c.valorParcelaInicial)!,
    periodicidade: Periodicidade[c.periodicidade],
    indiceReajuste: c.indiceReajuste,
    taxaMultaAtraso: taxa(c.taxaMultaAtraso),
    taxaJurosAtraso: taxa(c.taxaJurosAtraso),
    taxaDescontoQuitacao: taxa(c.taxaDescontoQuitacao),
    status: StatusContratoCredito[c.status],
    dataEncerramento: c.dataEncerramento ? c.dataEncerramento.toISOString() : null,
    motivoEncerramento: c.motivoEncerramento
      ? MotivoEncerramento[c.motivoEncerramento]
      : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export interface ItemContratadoApi {
  id: string;
  contratoId: string;
  descricao: string;
  natureza: string;
  origem: string;
  credor: string;
  credorId: string | null;
  valor: number;
  numeroParcelas: number | null;
  periodicidade: string | null;
  dataInicio: string;
  dataFim: string | null;
  status: string;
}

export function itemContratadoParaApi(i: ItemContratado): ItemContratadoApi {
  return {
    id: i.id,
    contratoId: i.contratoId,
    descricao: i.descricao,
    natureza: NaturezaProduto[i.natureza],
    origem: OrigemItemContratado[i.origem],
    credor: Credor[i.credor],
    credorId: i.credorId,
    valor: dec(i.valor)!,
    numeroParcelas: i.numeroParcelas,
    periodicidade: i.periodicidade ? Periodicidade[i.periodicidade] : null,
    dataInicio: i.dataInicio.toISOString(),
    dataFim: i.dataFim ? i.dataFim.toISOString() : null,
    status: StatusItemContratado[i.status],
  };
}

export interface ParcelaApi {
  id: string;
  contratoId: string;
  itemContratadoId: string;
  numero: number;
  totalParcelas: number;
  display: string;
  valorNominal: number;
  dataVencimento: string;
  dataPagamento: string | null;
  valorPago: number | null;
  valorEncargo: number | null;
  status: string; // rótulo resolvido em runtime (Regra 7)
  faturaId: string | null;
}

export function parcelaParaApi(p: Parcela): ParcelaApi {
  // Parcela coberta por acordo: vínculo via acordoId (status real continua null).
  // Para EXIBIÇÃO mostramos o rótulo "Renegociada" — sem gravar esse status (Regra 5).
  const statusLabel =
    p.acordoId && !p.status
      ? StatusParcela.RENEGOCIADA
      : // Status calculado em runtime: nunca lido do banco quando é em aberto/vencida.
        resolverStatusParcela({
          status: p.status ? StatusParcela[p.status] : null,
          dataVencimento: p.dataVencimento,
        });
  return {
    id: p.id,
    contratoId: p.contratoId,
    itemContratadoId: p.itemContratadoId,
    numero: p.numero,
    totalParcelas: p.totalParcelas,
    display: p.display,
    valorNominal: dec(p.valorNominal)!,
    dataVencimento: p.dataVencimento.toISOString(),
    dataPagamento: p.dataPagamento ? p.dataPagamento.toISOString() : null,
    valorPago: dec(p.valorPago),
    valorEncargo: dec(p.valorEncargo),
    status: statusLabel,
    faturaId: p.faturaId,
  };
}

// Helpers de criação (API lowercase -> enum Prisma).
export const periodicidadeParaPrisma = (v: string): PeriodicidadePrisma =>
  chavePrisma(Periodicidade, v) as PeriodicidadePrisma;
export const statusParcelaArmazenavel = StatusParcelaPrisma;
