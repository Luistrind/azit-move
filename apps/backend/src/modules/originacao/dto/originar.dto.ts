import { z } from 'zod';

// Payload de originação PopHub -> Azit (api-spec §2). snake_case (convenção do
// PopHub). Valores monetários em CENTAVOS. PLACEHOLDER: o contrato de integração
// final é a confirmar com a equipe do PopHub — nomes de campo podem mudar.
const itemSchema = z.object({
  tipo_produto: z.string().optional(),
  natureza: z.enum(['parcelado', 'recorrente']),
  valor_total: z.coerce.number().int().min(0).optional(),
  valor: z.coerce.number().int().min(0).optional(),
  valor_parcela: z.coerce.number().int().min(0).optional(),
  numero_parcelas: z.coerce.number().int().min(1).optional(),
  credor: z.enum(['azit', 'investidor', 'terceiro']).default('azit'),
  credor_id: z.string().min(1).optional(),
});

export const originarSchema = z.object({
  contrato: z.object({
    numero_origem: z.string().min(1),
    data_assinatura: z.coerce.date(),
    data_primeira_parcela: z.coerce.date(),
    periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).default('semanal'),
    indice_reajuste: z.string().optional(),
    taxa_multa_atraso: z.coerce.number().optional(),
    taxa_juros_atraso_mensal: z.coerce.number().optional(),
    taxa_desconto_quitacao_diaria: z.coerce.number().optional(),
  }),
  cliente: z.object({
    nome: z.string().trim().min(1),
    tipo_pessoa: z.enum(['pf', 'pj']).default('pf'),
    cpf_cnpj: z.string().min(1),
    rg: z.string().optional(),
    estado_civil: z.string().optional(),
    profissao: z.string().optional(),
    whatsapp: z.string().min(1),
    email: z.string().optional(),
    endereco: z.string().optional(),
    numero: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    estado: z.string().optional(),
    cep: z.string().optional(),
    asaas_customer_id: z.string().optional(),
  }),
  ativo: z.object({
    chassi: z.string().min(1),
    renavam: z.string().optional(),
    placa: z.string().optional(),
    marca: z.string().optional(),
    modelo: z.string().optional(),
    ano_fabricacao: z.coerce.number().int().optional(),
    ano_modelo: z.coerce.number().int().optional(),
    cor: z.string().optional(),
    origem: z.enum(['locadora', 'particular', 'concessionaria']).optional(),
    combustivel: z.enum(['flex', 'gasolina', 'eletrico', 'diesel', 'hibrido']).optional(),
    quilometragem_entrada: z.coerce.number().int().optional(),
    valor_aquisicao: z.coerce.number().int().min(0).optional(),
  }),
  itens_contratados: z.array(itemSchema).min(1),
  entrada: z
    .object({
      valor: z.coerce.number().int().min(0).default(0),
      asaas_payment_id: z.string().optional(),
      data_pagamento: z.string().optional(),
    })
    .optional(),
});

export type OriginarDto = z.infer<typeof originarSchema>;
