import { z } from 'zod';

// Cadastro pleno do comprador (para promover Lead → Titular na proposta — 7.6).
// Espelha CriarTitularDto; opcional quando a simulação já tem titular.
const cadastroCompradorSchema = z.object({
  nome: z.string().trim().min(1),
  tipoPessoa: z.enum(['pf', 'pj']).default('pf'),
  cpfCnpj: z.string().min(1),
  rg: z.string().trim().optional(),
  estadoCivil: z.string().trim().optional(),
  profissao: z.string().trim().optional(),
  whatsapp: z.string().trim().min(1),
  email: z.string().trim().email().optional(),
  endereco: z.string().trim().optional(),
  bairro: z.string().trim().optional(),
  cidade: z.string().trim().optional(),
  estado: z.string().trim().optional(),
  cep: z.string().trim().optional(),
});

// 7.5 — Proposta a partir da oferta selecionada de uma simulação.
export const criarPropostaSchema = z.object({
  simulacaoId: z.string().min(1, 'simulacaoId é obrigatório'),
  modalidade: z
    .enum(['assinatura', 'compra_parcelada', 'compra_vista'])
    .default('compra_parcelada'),
  comprador: cadastroCompradorSchema.optional(),
});
export type CriarPropostaDto = z.infer<typeof criarPropostaSchema>;

// 7.5 — transição de status no Kanban (movimentos livres válidos).
export const patchStatusPropostaSchema = z.object({
  status: z.enum(['pendente', 'em_analise', 'em_formalizacao', 'cancelada']),
});
export type PatchStatusPropostaDto = z.infer<typeof patchStatusPropostaSchema>;

// 7.7 — adicionar papel (comprador secundário / garantidor) a uma proposta.
export const adicionarVinculoSchema = z.object({
  papel: z.enum(['comprador_secundario', 'garantidor']),
  titular: cadastroCompradorSchema,
});
export type AdicionarVinculoDto = z.infer<typeof adicionarVinculoSchema>;

// 7.8 — anexo de documento digital por papel. arquivoRef é mock (sem upload real).
export const anexarDocumentoSchema = z.object({
  titularId: z.string().min(1),
  tipo: z.enum(['cnh', 'comprovante_endereco', 'comprovante_renda', 'relatorio_brick', 'outro']),
  arquivoRef: z.string().trim().min(1).default('mock://documento'),
});
export type AnexarDocumentoDto = z.infer<typeof anexarDocumentoSchema>;

// 7.8 — parecer da análise de crédito.
export const registrarParecerSchema = z.object({
  resultado: z.enum(['aprovado', 'aprovado_com_ressalvas', 'reprovado']),
  motivoReprovacao: z.string().trim().min(1).optional(),
  exigeGarantidor: z.boolean().default(false),
});
export type RegistrarParecerDto = z.infer<typeof registrarParecerSchema>;
