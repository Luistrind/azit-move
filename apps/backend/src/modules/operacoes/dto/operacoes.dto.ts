import { z } from 'zod';

// Valores monetários em CENTAVOS inteiros.

export const criarRenegociacaoSchema = z.object({
  valorEntrada: z.coerce.number().int().min(0),
  numeroParcelasNovas: z.coerce.number().int().min(1),
  valorParcelaNova: z.coerce.number().int().min(1),
});
export type CriarRenegociacaoBody = z.infer<typeof criarRenegociacaoSchema>;

export const quitacaoSchema = z.object({
  parcelaIds: z.array(z.string().min(1)).optional(),
});
export type QuitacaoBody = z.infer<typeof quitacaoSchema>;

export const sinistroSchema = z.object({
  valorIndenizacao: z.coerce.number().int().min(0),
});
export type SinistroBody = z.infer<typeof sinistroSchema>;
