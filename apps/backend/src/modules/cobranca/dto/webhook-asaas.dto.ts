import { z } from 'zod';

// Payload de webhook do Asaas (api-spec §3). Validamos o essencial; campos extras
// são ignorados. externalReference = id da fatura (ou do acordo, em renegociação).
export const webhookAsaasSchema = z.object({
  event: z.string().min(1),
  payment: z.object({
    id: z.string().optional(),
    externalReference: z.string().min(1),
    value: z.number().optional(),
    paymentDate: z.string().optional(),
    dueDate: z.string().optional(),
    fineValue: z.number().optional(),
    interestValue: z.number().optional(),
    status: z.string().optional(),
  }),
});

export type WebhookAsaasDto = z.infer<typeof webhookAsaasSchema>;
