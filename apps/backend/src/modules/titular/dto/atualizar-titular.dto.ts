import { z } from 'zod';
import { validarDocumento } from '@azit/utils';

// Atualização parcial de Titular (item 2.1). Todos os campos opcionais; quando
// cpfCnpj vem junto com tipoPessoa, o documento é revalidado.
export const atualizarTitularSchema = z
  .object({
    nome: z.string().trim().min(1).optional(),
    tipoPessoa: z.enum(['pf', 'pj']).optional(),
    cpfCnpj: z.string().min(1).optional(),
    rg: z.string().trim().nullish(),
    estadoCivil: z.string().trim().nullish(),
    profissao: z.string().trim().nullish(),
    whatsapp: z.string().trim().min(1).optional(),
    email: z.string().trim().email('E-mail inválido').nullish(),
    endereco: z.string().trim().nullish(),
    bairro: z.string().trim().nullish(),
    cidade: z.string().trim().nullish(),
    estado: z.string().trim().nullish(),
    cep: z.string().trim().nullish(),
    status: z.enum(['ativo', 'inativo', 'bloqueado']).optional(),
  })
  .superRefine((data, ctx) => {
    // Só valida o documento quando há base suficiente (cpfCnpj + tipoPessoa).
    if (data.cpfCnpj !== undefined && data.tipoPessoa !== undefined) {
      if (!validarDocumento(data.cpfCnpj, data.tipoPessoa)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cpfCnpj'],
          message: data.tipoPessoa === 'pf' ? 'CPF inválido' : 'CNPJ inválido',
        });
      }
    } else if (data.cpfCnpj !== undefined && !validarDocumento(data.cpfCnpj)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cpfCnpj'],
        message: 'CPF/CNPJ inválido',
      });
    }
  });

export type AtualizarTitularDto = z.infer<typeof atualizarTitularSchema>;
