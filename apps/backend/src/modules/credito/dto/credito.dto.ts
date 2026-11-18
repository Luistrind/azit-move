import { z } from 'zod';

// Crédito de manutenção (crédito avulso para cliente já ativo) — Doc 2 §4.7-A.
// Valores em CENTAVOS. Produto de valor variável: o valor é definido aqui, não fixo.
export const originarCreditoSchema = z.object({
  descricao: z.string().trim().min(3).default('Crédito de manutenção'),
  valor: z.coerce.number().int().min(1), // centavos — valor do crédito
  numeroParcelas: z.coerce.number().int().min(1).max(120),
  valorEntrada: z.coerce.number().int().min(0).default(0), // centavos — opcional
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('mensal'),
  // Doc 02 §18.5 (13/09): o RP paga o FORNECEDOR do cliente — obrigatório
  // quando o produto é Reembolso Parcelado (o service valida).
  fornecedorId: z.string().min(1).optional(),
  // "De acordo" do cliente pelo WhatsApp (doc 02 §18.7, 18/11): o Reembolso Parcelado
  // vale por ele, sem contrato nem assinatura — obrigatório no RP (o service valida).
  // Mesmos nomes do Acordo de pagamento (§7.7).
  aceiteWhatsapp: z.boolean().optional(),
  mensagemWhatsapp: z.string().trim().max(4000).optional(),
  respostaCliente: z.string().trim().max(2000).optional(),
  observacao: z.string().trim().max(2000).optional(),
});
export type OriginarCreditoDto = z.infer<typeof originarCreditoSchema>;

// Prévia da parcela (não persiste) — alimenta o "simular" da tela.
export const simularCreditoSchema = z.object({
  titularId: z.string().optional(), // p/ checar o limite de 30% do Reembolso Parcelado
  valor: z.coerce.number().int().min(1),
  numeroParcelas: z.coerce.number().int().min(1).max(120),
  valorEntrada: z.coerce.number().int().min(0).default(0),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('mensal'),
});
export type SimularCreditoDto = z.infer<typeof simularCreditoSchema>;

export const reprovarCreditoSchema = z.object({
  motivo: z.string().trim().min(1).optional(),
});
export type ReprovarCreditoDto = z.infer<typeof reprovarCreditoSchema>;

// Reembolso Parcelado aprovado ANTES de 18/11 e parado em "aguardando assinatura":
// registra o "de acordo" do cliente e ativa (doc 02 §18.7).
export const registrarDeAcordoSchema = z.object({
  aceiteWhatsapp: z.boolean(),
  mensagemWhatsapp: z.string().trim().max(4000).optional(),
  respostaCliente: z.string().trim().max(2000).optional(),
});
export type RegistrarDeAcordoDto = z.infer<typeof registrarDeAcordoSchema>;
