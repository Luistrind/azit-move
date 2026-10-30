import { z } from 'zod';

// Consultas da visão da carteira por período (doc 02 §27). Datas são
// data-calendário no fuso do negócio (YYYY-MM-DD); meses YYYY-MM.
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const MES = z.string().regex(/^\d{4}-\d{2}$/, 'use YYYY-MM');

export const visaoPeriodoSchema = z
  .object({ de: DIA, ate: DIA })
  .refine((q) => q.de <= q.ate, { message: '"de" deve ser anterior ou igual a "ate"', path: ['ate'] });
export type VisaoPeriodoQuery = z.infer<typeof visaoPeriodoSchema>;

export const visaoMensalSchema = z
  .object({ de: MES, ate: MES })
  .refine((q) => q.de <= q.ate, { message: '"de" deve ser anterior ou igual a "ate"', path: ['ate'] });
export type VisaoMensalQuery = z.infer<typeof visaoMensalSchema>;

export const ESTADOS_VISAO = ['recebidas', 'vencidas', 'a_vencer'] as const;
export type EstadoVisaoQuery = (typeof ESTADOS_VISAO)[number];

export const visaoClientesSchema = visaoPeriodoSchema.and(z.object({ estado: z.enum(ESTADOS_VISAO) }));
export type VisaoClientesQuery = z.infer<typeof visaoClientesSchema>;
