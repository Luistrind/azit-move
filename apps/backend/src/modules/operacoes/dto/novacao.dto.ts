import { z } from 'zod';

// Novação (Doc 2 §4.16, §7.7b) — recuperação radical: liquida o contrato origem
// e cria um contrato NOVO com estas condições. Valores em CENTAVOS.
export const novacaoSchema = z.object({
  dataAssinatura: z.coerce.date().optional(),
  dataPrimeiraParcela: z.coerce.date(),
  valorTotal: z.coerce.number().int().min(0),
  valorEntrada: z.coerce.number().int().min(0).default(0),
  numeroParcelas: z.coerce.number().int().min(1),
  valorParcelaInicial: z.coerce.number().int().min(1),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('semanal'),
  observacao: z.string().trim().min(1).optional(),
});
export type NovacaoBody = z.infer<typeof novacaoSchema>;

// Simulação da proposta de novação (A7 passos 3-4, doc adaptações 13/09).
// O saldo vem da DECOMPOSIÇÃO (F1) — o operador escolhe só prazo/frequência,
// desconto (comitê) e recebimento inicial. Centavos.
export const simularNovacaoSchema = z.object({
  numeroParcelasVeiculo: z.coerce.number().int().min(1),
  frequencia: z.enum(['semanal', 'quinzenal', 'mensal']).optional(), // default: herdada
  desconto: z.coerce.number().int().min(0).optional(),
  recebimentoInicial: z.coerce.number().int().min(0).optional(),
});
export type SimularNovacaoBody = z.infer<typeof simularNovacaoSchema>;
