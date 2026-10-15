import { z } from 'zod';

// Simulação da proposta de novação (A7 passos 3-4, doc adaptações 13/09).
// O saldo vem da DECOMPOSIÇÃO (F1) — o operador escolhe PRAZO em meses (como
// na simulação da originação; a frequência dita o nº de parcelas pelo fator
// padrão 4,3452/2,1726 — correção 14/09), desconto (comitê) e recebimento.
export const simularNovacaoSchema = z
  .object({
    prazoMeses: z.coerce.number().int().min(1).optional(),
    numeroParcelasVeiculo: z.coerce.number().int().min(1).optional(), // alternativa direta
    frequencia: z.enum(['semanal', 'quinzenal', 'mensal']).optional(), // default: herdada
    desconto: z.coerce.number().int().min(0).optional(),
    recebimentoInicial: z.coerce.number().int().min(0).optional(),
    // Troca de veículo (F3 — A5): ativo DISPONÍVEL no estoque; ajuste pelo
    // valor de cadastro (entra − sai).
    trocaAtivoId: z.string().min(1).optional(),
    // Acréscimo ao saldo (09/10): valor somado à dívida, com motivo (ex.:
    // orçamento da avaria do veículo devolvido).
    acrescimo: z.coerce.number().int().min(0).optional(),
    acrescimoMotivo: z.string().trim().max(200).optional(),
    // 1ª parcela do contrato novo (15/10): default = ciclo da conta; o operador escolhe.
    dataPrimeiraParcela: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((d) => !d.acrescimo || !!d.acrescimoMotivo, { message: 'Diga o motivo do acréscimo (ex.: avaria do veículo devolvido — orçamento nº …)', path: ['acrescimoMotivo'] })
  .refine((d) => d.prazoMeses !== undefined || d.numeroParcelasVeiculo !== undefined, {
    message: 'Informe o prazo em meses (ou o número de parcelas)',
    path: ['prazoMeses'],
  });
export type SimularNovacaoBody = z.infer<typeof simularNovacaoSchema>;

// Proposta formal (F2): mesmos termos da simulação + observação. O servidor
// re-simula e CONGELA tudo no snapshot — o cliente não dita números.
export const solicitarNovacaoSchema = z
  .object({
    prazoMeses: z.coerce.number().int().min(1).optional(),
    numeroParcelasVeiculo: z.coerce.number().int().min(1).optional(),
    frequencia: z.enum(['semanal', 'quinzenal', 'mensal']).optional(),
    desconto: z.coerce.number().int().min(0).optional(),
    recebimentoInicial: z.coerce.number().int().min(0).optional(),
    trocaAtivoId: z.string().min(1).optional(),
    acrescimo: z.coerce.number().int().min(0).optional(),
    acrescimoMotivo: z.string().trim().max(200).optional(),
    dataPrimeiraParcela: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Contrato ÚNICO (adaptação 13/10, até o instrumento de novação ficar
    // pronto): um só contrato de Compra Parcelada com o valor global.
    contratoUnico: z.boolean().optional(),
    observacao: z.string().trim().min(1).optional(),
  })
  .refine((d) => !d.acrescimo || !!d.acrescimoMotivo, { message: 'Diga o motivo do acréscimo', path: ['acrescimoMotivo'] })
  .refine((d) => d.prazoMeses !== undefined || d.numeroParcelasVeiculo !== undefined, {
    message: 'Informe o prazo em meses (ou o número de parcelas)',
    path: ['prazoMeses'],
  });
export type SolicitarNovacaoBody = z.infer<typeof solicitarNovacaoSchema>;

// Troca da 1ª parcela enquanto a novação aguarda assinatura (15/10, Idanilza):
// regenera o instrumento e reenvia à assinatura.
export const primeiraParcelaNovacaoSchema = z.object({
  dataPrimeiraParcela: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD'),
});
export type PrimeiraParcelaNovacaoBody = z.infer<typeof primeiraParcelaNovacaoSchema>;
