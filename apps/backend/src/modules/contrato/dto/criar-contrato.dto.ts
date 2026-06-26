import { z } from 'zod';

// Criação de ContratoCredito + cronograma (Doc 2 §8.1, Doc 7 itens 3.1–3.4).
// Valores monetários em CENTAVOS inteiros. O item de financiamento âncora é
// derivado destes termos; itens recorrentes (proteção/taxa) são opcionais e NÃO
// geram parcela (cobrados em fatura — Bloco 4).
const itemRecorrenteSchema = z.object({
  descricao: z.string().trim().min(1),
  credor: z.enum(['azit', 'investidor', 'terceiro']).default('azit'),
  credorId: z.string().min(1).optional(),
  valor: z.coerce.number().int().min(0),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).optional(),
  dataFim: z.coerce.date().optional(),
});

export const criarContratoSchema = z.object({
  contaId: z.string().min(1, 'contaId é obrigatório'),
  ativoId: z.string().min(1, 'ativoId é obrigatório'),
  numero: z.string().trim().min(1).optional(), // gerado se ausente
  pophubId: z.string().trim().min(1).optional(),
  dataAssinatura: z.coerce.date(),
  dataPrimeiraParcela: z.coerce.date(),
  valorTotal: z.coerce.number().int().min(0),
  valorEntrada: z.coerce.number().int().min(0).default(0),
  numeroParcelas: z.coerce.number().int().min(1),
  valorParcelaInicial: z.coerce.number().int().min(0),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('semanal'),
  indiceReajuste: z.string().trim().min(1).optional(),
  descricaoFinanciamento: z.string().trim().min(1).default('Parcelamento do veículo'),
  credor: z.enum(['azit', 'investidor', 'terceiro']).default('azit'),
  credorId: z.string().min(1).optional(),
  taxaMultaAtraso: z.coerce.number().min(0).optional(),
  taxaJurosAtraso: z.coerce.number().min(0).optional(),
  taxaDescontoQuitacao: z.coerce.number().min(0).max(1).optional(),
  itensRecorrentes: z.array(itemRecorrenteSchema).optional(),
});

export type CriarContratoDto = z.infer<typeof criarContratoSchema>;
