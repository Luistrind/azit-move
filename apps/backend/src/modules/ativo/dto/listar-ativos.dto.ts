import { z } from 'zod';

// Filtros de listagem de ativos (api-spec §4.9: status, placa, chassi, page, limit).
export const listarAtivosSchema = z.object({
  status: z
    .enum(['disponivel', 'em_contrato', 'quitado', 'recuperado', 'sinistrado'])
    .optional(),
  placa: z.string().trim().min(1).optional(),
  chassi: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListarAtivosDto = z.infer<typeof listarAtivosSchema>;
