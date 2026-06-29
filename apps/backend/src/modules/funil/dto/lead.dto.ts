import { z } from 'zod';

// Lead — pré-cadastro leve (Doc 2 §4-A.1). Mínimo para liberar a simulação.
export const criarLeadSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  cpf: z.string().trim().min(1, 'CPF é obrigatório'),
  dataNascimento: z.coerce.date().optional(),
  canalOrigem: z.enum(['operador_interno', 'landing_page', 'outro']).default('operador_interno'),
});

export type CriarLeadDto = z.infer<typeof criarLeadSchema>;
