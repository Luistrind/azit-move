import { z } from 'zod';

// Payload de webhook do Asaas (api-spec §3). Validamos só o mínimo e toleramos o
// resto: o Asaas dispara MUITOS eventos (inclusive testes e cobranças sem
// externalReference) e qualquer resposta != 2xx faz o Asaas marcar a entrega como
// falha e, após N falhas, INTERROMPER a fila de sincronização. Por isso o payment e
// o externalReference são opcionais aqui — o handler decide ignorar (202) quando não
// houver o que conciliar, em vez de devolver 400.
export const webhookAsaasSchema = z.object({
  event: z.string().min(1),
  // Todos os campos aceitam null (o Asaas manda muitos campos como null, ex.:
  // interestValue/fineValue/paymentDate) — usar .nullish() (null OU ausente) em vez
  // de .optional(), senão um null quebra a validação e vira 400 (e o Asaas pune a fila).
  payment: z
    .object({
      id: z.string().nullish(),
      externalReference: z.string().nullish(),
      value: z.number().nullish(),
      paymentDate: z.string().nullish(),
      dueDate: z.string().nullish(),
      fineValue: z.number().nullish(),
      interestValue: z.number().nullish(),
      status: z.string().nullish(),
    })
    .nullish(),
});

export type WebhookAsaasDto = z.infer<typeof webhookAsaasSchema>;
