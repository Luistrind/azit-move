import { z } from 'zod';
import { validarDocumento } from '@azit/utils';

// Criação de Titular (Doc 2 §4.1, Doc 7 item 2.1). tipoPessoa/status em lowercase
// (api-spec + @azit/types); o mapeamento para o enum Prisma acontece no service.
export const criarTitularSchema = z
  .object({
    nome: z.string().trim().min(1, 'Nome é obrigatório'),
    tipoPessoa: z.enum(['pf', 'pj']),
    cpfCnpj: z.string().min(1, 'CPF/CNPJ é obrigatório'),
    rg: z.string().trim().optional(),
    estadoCivil: z.string().trim().optional(),
    profissao: z.string().trim().optional(),
    whatsapp: z.string().trim().min(1, 'WhatsApp é obrigatório'),
    email: z.string().trim().email('E-mail inválido').optional(),
    endereco: z.string().trim().optional(),
    bairro: z.string().trim().optional(),
    cidade: z.string().trim().optional(),
    estado: z.string().trim().optional(),
    cep: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (!validarDocumento(data.cpfCnpj, data.tipoPessoa)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cpfCnpj'],
        message:
          data.tipoPessoa === 'pf' ? 'CPF inválido' : 'CNPJ inválido',
      });
    }
  });

export type CriarTitularDto = z.infer<typeof criarTitularSchema>;
