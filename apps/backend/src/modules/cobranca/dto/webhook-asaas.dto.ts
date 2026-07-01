import { z } from 'zod';

// Payload de webhook do Asaas (api-spec §3). Validamos só o mínimo e toleramos o
// resto: o Asaas dispara MUITOS eventos (inclusive testes e cobranças sem
// externalReference) e qualquer resposta != 2xx faz o Asaas marcar a entrega como
// falha e, após N falhas, INTERROMPER a fila de sincronização. Por isso o payment e
// o externalReference são opcionais aqui — o handler decide ignorar (202) quando não
// houver o que conciliar, em vez de devolver 400.
export const webhookAsaasSchema = z.object({
  event: z.string().min(1),
  payment: z
    .object({
      id: z.string().optional(),
      externalReference: z.string().nullish(),
      value: z.number().optional(),
      paymentDate: z.string().nullish(),
      dueDate: z.string().nullish(),
      fineValue: z.number().optional(),
      interestValue: z.number().optional(),
      status: z.string().optional(),
    })
    .optional(),
});

export type WebhookAsaasDto = z.infer<typeof webhookAsaasSchema>;
