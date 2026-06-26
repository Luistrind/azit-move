import { z } from 'zod';

// Login interno por email + senha (Doc 6 §2.1).
export const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(1, 'Senha obrigatória'),
});

export type LoginDto = z.infer<typeof loginSchema>;
