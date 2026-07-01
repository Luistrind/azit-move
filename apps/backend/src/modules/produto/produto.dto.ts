import { z } from 'zod';

// Catálogo de Produtos (Doc 2 §4.8). valorPadrao em CENTAVOS.
export const criarProdutoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  natureza: z.enum(['parcelado', 'recorrente']),
  credorPadrao: z.enum(['azit', 'investidor', 'terceiro']).default('azit'),
  apartado: z.boolean().default(false),
  valorPadrao: z.coerce.number().int().min(0).optional(),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).optional(),
  ancora: z.boolean().default(false),
});
export type CriarProdutoBody = z.infer<typeof criarProdutoSchema>;

export const atualizarProdutoSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  natureza: z.enum(['parcelado', 'recorrente']).optional(),
  credorPadrao: z.enum(['azit', 'investidor', 'terceiro']).optional(),
  apartado: z.boolean().optional(),
  valorPadrao: z.coerce.number().int().min(0).nullish(),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).nullish(),
  ancora: z.boolean().optional(),
  ativo: z.boolean().optional(),
});
export type AtualizarProdutoBody = z.infer<typeof atualizarProdutoSchema>;
