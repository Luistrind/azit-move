import { z } from 'zod';

// Valores monetários em CENTAVOS inteiros.

export const criarRenegociacaoSchema = z.object({
  valorEntrada: z.coerce.number().int().min(0),
  numeroParcelasNovas: z.coerce.number().int().min(1),
  // Placeholder: com o motor do Catálogo ATIVO a parcela é CALCULADA no servidor
  // (RAP031) e este campo é ignorado; sem motor, vale a divisão simples.
  valorParcelaNova: z.coerce.number().int().min(0).optional().default(0),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).optional(), // ignorada com motor ativo (frequência herdada)
  // Data-limite dura da entrada (decisão 2026-08-18) — 'YYYY-MM-DD'.
  dataPagamentoEntrada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Seleção por FATURA (doc Acordo de Pagamento V1.0 RAP006): excluir uma
  // fatura pré-selecionada exige justificativa textual auditável.
  faturasExcluidas: z
    .array(z.object({ faturaId: z.string().min(1), justificativa: z.string().trim().min(10, 'Justificativa da exclusão precisa de pelo menos 10 caracteres') }))
    .optional(),
});
export type CriarRenegociacaoBody = z.infer<typeof criarRenegociacaoSchema>;

export const quitacaoSchema = z.object({
  parcelaIds: z.array(z.string().min(1)).optional(),
});
export type QuitacaoBody = z.infer<typeof quitacaoSchema>;

export const sinistroSchema = z.object({
  valorIndenizacao: z.coerce.number().int().min(0),
});
export type SinistroBody = z.infer<typeof sinistroSchema>;

export const reajusteSchema = z.object({
  indicePercentual: z.coerce.number().min(0).max(100), // ex: 4.5 = 4,5%
});
export type ReajusteBody = z.infer<typeof reajusteSchema>;
