import { z } from 'zod';

// Lead — fase 1 do atendimento (Doc 2 §4-A.1): nome, cpf, telefone, canal de origem.
export const criarLeadSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  cpf: z.string().trim().min(1, 'CPF é obrigatório'),
  telefone: z.string().trim().min(8, 'Telefone é obrigatório'),
  canalOrigem: z
    .enum(['operador_interno', 'landing_page', 'olx', 'whatsapp', 'instagram', 'indicacao', 'outro'])
    .default('operador_interno'),
  dataNascimento: z.coerce.date().optional(),
});

export type CriarLeadDto = z.infer<typeof criarLeadSchema>;
