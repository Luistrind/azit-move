import { z } from 'zod';

// Filtros da Carteira Operacional (api-spec §4.1: status, conta_id, page, limit).
// status aceita o rótulo de exibição (@azit/types), ex: "Ativo", "Inadimplente".
export const listarContratosSchema = z.object({
  status: z.string().trim().min(1).optional(),
  contaId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListarContratosDto = z.infer<typeof listarContratosSchema>;
