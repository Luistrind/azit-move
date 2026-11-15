import { z } from 'zod';

// Entrada com Google (doc 06 §2.2): o navegador manda o ID token emitido pelo
// Google ao botão oficial; o backend valida e emite os tokens do sistema.
export const googleSchema = z.object({
  credential: z.string().min(20, 'credential obrigatório'),
});

export type GoogleDto = z.infer<typeof googleSchema>;
