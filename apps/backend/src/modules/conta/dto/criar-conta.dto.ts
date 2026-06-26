import { z } from 'zod';

// Abertura de conta vinculada a um titular (Doc 2 §4.3, item 2.2). 1:1 com Titular.
export const criarContaSchema = z.object({
  titularId: z.string().min(1, 'titularId é obrigatório'),
});

export type CriarContaDto = z.infer<typeof criarContaSchema>;
