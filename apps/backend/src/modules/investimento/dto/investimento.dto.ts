import { z } from 'zod';

// ContratoInvestimento (Doc 2 §4.6, item 8.1). valorAportado em CENTAVOS;
// taxaRetorno é fração decimal (0.015 = 1,5%); datas ISO.
export const criarInvestimentoSchema = z.object({
  contaId: z.string().min(1),
  modelo: z.enum(['ativo_especifico', 'fundo_coletivo', 'fundo_exclusivo']),
  valorAportado: z.coerce.number().int().min(1),
  taxaRetorno: z.coerce.number().min(0).max(1).optional(),
  dataAporte: z.coerce.date(),
  dataInicio: z.coerce.date().optional(),
  dataVencimento: z.coerce.date().optional(),
});
export type CriarInvestimentoDto = z.infer<typeof criarInvestimentoSchema>;

export const listarInvestimentosSchema = z.object({
  contaId: z.string().trim().min(1).optional(),
  status: z.enum(['ativo', 'encerrado']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListarInvestimentosDto = z.infer<typeof listarInvestimentosSchema>;
