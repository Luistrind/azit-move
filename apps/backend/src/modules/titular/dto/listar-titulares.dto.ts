import { z } from 'zod';

// Filtros de listagem de titulares (api-spec §4.8: nome, cpf_cnpj, status, page, limit).
// Coerção de page/limit porque query string chega como texto.
export const listarTitularesSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  cpfCnpj: z.string().trim().min(1).optional(),
  status: z.enum(['ativo', 'inativo', 'bloqueado']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListarTitularesDto = z.infer<typeof listarTitularesSchema>;
