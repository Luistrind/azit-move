import { z } from 'zod';

// Novação (Doc 2 §4.16, §7.7b) — recuperação radical: liquida o contrato origem
// e cria um contrato NOVO com estas condições. Valores em CENTAVOS.
export const novacaoSchema = z.object({
  dataAssinatura: z.coerce.date().optional(),
  dataPrimeiraParcela: z.coerce.date(),
  valorTotal: z.coerce.number().int().min(0),
  valorEntrada: z.coerce.number().int().min(0).default(0),
  numeroParcelas: z.coerce.number().int().min(1),
  valorParcelaInicial: z.coerce.number().int().min(1),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('semanal'),
  observacao: z.string().trim().min(1).optional(),
});
export type NovacaoBody = z.infer<typeof novacaoSchema>;
