import { z } from 'zod';

// Simulação V3 (Doc 2 §4-A.2). Valores em CENTAVOS. Ativo OU valor à vista manual.
export const criarSimulacaoSchema = z.object({
  leadId: z.string().min(1).optional(),
  titularId: z.string().min(1).optional(),
  ativoId: z.string().min(1).optional(),
  valorAvista: z.coerce.number().int().min(1).optional(), // obrigatório sem ativo
  observacoes: z.string().trim().optional(),
});
export type CriarSimulacaoDto = z.infer<typeof criarSimulacaoSchema>;

// "Simular outras opções" (Tela 3): cenário personalizado dentro da simulação.
export const simularOpcaoSchema = z.object({
  valorEntrada: z.coerce.number().int().min(0),
  prazoMeses: z.coerce.number().int().min(1),
  frequencia: z.enum(['mensal', 'quinzenal', 'semanal']),
  entradaParcelada: z.boolean().default(false),
});
export type SimularOpcaoDto = z.infer<typeof simularOpcaoSchema>;

export const selecionarOfertaSchema = z.object({
  ofertaId: z.string().min(1),
});
export type SelecionarOfertaDto = z.infer<typeof selecionarOfertaSchema>;
