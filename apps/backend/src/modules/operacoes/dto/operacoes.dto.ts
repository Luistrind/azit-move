import { z } from 'zod';

// Valores monetários em CENTAVOS inteiros.

export const criarRenegociacaoSchema = z.object({
  valorEntrada: z.coerce.number().int().min(0),
  numeroParcelasNovas: z.coerce.number().int().min(1),
  valorParcelaNova: z.coerce.number().int().min(1),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).optional(), // plano do acordo (default semanal)
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

export const reajusteSchema = z.object({
  indicePercentual: z.coerce.number().min(0).max(100), // ex: 4.5 = 4,5%
});
export type ReajusteBody = z.infer<typeof reajusteSchema>;
