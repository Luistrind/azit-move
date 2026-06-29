import { z } from 'zod';

// Cadastro de ativo (Doc 2 §4.4, item 2.3). Enums em lowercase; valorAquisicao em
// CENTAVOS inteiros (convenção do domínio). Mapeamento para Prisma no service.
export const criarAtivoSchema = z.object({
  tipo: z.enum(['veiculo', 'outro']).default('veiculo'),
  descricao: z.string().trim().min(1, 'Descrição é obrigatória'),
  marca: z.string().trim().optional(),
  modelo: z.string().trim().optional(),
  anoFabricacao: z.coerce.number().int().min(1900).max(2100).optional(),
  anoModelo: z.coerce.number().int().min(1900).max(2100).optional(),
  cor: z.string().trim().optional(),
  placa: z.string().trim().min(1).optional(),
  chassi: z.string().trim().min(1).optional(),
  renavam: z.string().trim().optional(),
  origem: z.enum(['locadora', 'particular', 'concessionaria']).optional(),
  combustivel: z
    .enum(['flex', 'gasolina', 'eletrico', 'diesel', 'hibrido'])
    .optional(),
  quilometragemEntrada: z.coerce.number().int().min(0).optional(),
  valorAquisicao: z.coerce.number().int().min(0).optional(),
  // valorVenda (centavos): base da precificação individualizada na simulação (Doc 2 §4.4).
  valorVenda: z.coerce.number().int().min(0).optional(),
  // vínculo opcional a pacote/oferta genérica (andaime de transição, legado PopHub).
  pacoteOfertaId: z.string().trim().min(1).optional(),
});

export type CriarAtivoDto = z.infer<typeof criarAtivoSchema>;
