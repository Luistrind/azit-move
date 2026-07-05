import { z } from 'zod';

// Crédito de manutenção (crédito avulso para cliente já ativo) — Doc 2 §4.7-A.
// Valores em CENTAVOS. Produto de valor variável: o valor é definido aqui, não fixo.
export const originarCreditoSchema = z.object({
  descricao: z.string().trim().min(3).default('Crédito de manutenção'),
  valor: z.coerce.number().int().min(1), // centavos — valor do crédito
  numeroParcelas: z.coerce.number().int().min(1).max(120),
  valorEntrada: z.coerce.number().int().min(0).default(0), // centavos — opcional
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('mensal'),
});
export type OriginarCreditoDto = z.infer<typeof originarCreditoSchema>;

// Prévia da parcela (não persiste) — alimenta o "simular" da tela.
export const simularCreditoSchema = z.object({
  valor: z.coerce.number().int().min(1),
  numeroParcelas: z.coerce.number().int().min(1).max(120),
  valorEntrada: z.coerce.number().int().min(0).default(0),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('mensal'),
});
export type SimularCreditoDto = z.infer<typeof simularCreditoSchema>;

export const reprovarCreditoSchema = z.object({
  motivo: z.string().trim().min(1).optional(),
});
export type ReprovarCreditoDto = z.infer<typeof reprovarCreditoSchema>;
