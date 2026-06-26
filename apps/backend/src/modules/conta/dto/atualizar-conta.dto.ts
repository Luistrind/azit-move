import { z } from 'zod';

// Atualização de conta — por ora só o status (Doc 2 §4.3: ativa | suspensa | encerrada).
export const atualizarContaSchema = z.object({
  status: z.enum(['ativa', 'suspensa', 'encerrada']),
});

export type AtualizarContaDto = z.infer<typeof atualizarContaSchema>;
