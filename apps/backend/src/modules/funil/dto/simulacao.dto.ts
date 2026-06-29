import { z } from 'zod';

// Simulação sobre um Ativo (Doc 2 §4-A.2). Valores em CENTAVOS. Descartável:
// guarda-se só a oferta escolhida ao avançar. lead/titular podem vir depois.
export const criarSimulacaoSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    titularId: z.string().min(1).optional(),
    ativoId: z.string().min(1, 'ativoId é obrigatório'),
    valorEntrada: z.coerce.number().int().min(0).default(0),
    prazoSemanas: z.coerce.number().int().min(1).max(260),
    periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('semanal'),
    entradaParcelada: z.boolean().default(false),
    observacoes: z.string().trim().min(1).optional(),
  })
  .refine((d) => !(d.leadId && d.titularId), {
    message: 'Informe lead OU titular, não ambos',
  });

export type CriarSimulacaoDto = z.infer<typeof criarSimulacaoSchema>;

export const selecionarOfertaSchema = z.object({
  ofertaId: z.string().min(1, 'ofertaId é obrigatório'),
});
export type SelecionarOfertaDto = z.infer<typeof selecionarOfertaSchema>;
