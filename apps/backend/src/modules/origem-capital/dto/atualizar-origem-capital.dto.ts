import { z } from 'zod';

// Atualização da origem de capital (item 2.4): valores e status.
export const atualizarOrigemCapitalSchema = z.object({
  valorAportado: z.coerce.number().int().min(0).optional(),
  taxaRetorno: z.coerce.number().min(0).max(1).nullish(),
  dataAporte: z.coerce.date().optional(),
  status: z.enum(['ativo', 'encerrado']).optional(),
});

export type AtualizarOrigemCapitalDto = z.infer<
  typeof atualizarOrigemCapitalSchema
>;
