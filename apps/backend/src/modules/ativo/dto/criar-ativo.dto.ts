import { z } from 'zod';

// Cadastro de ativo (Doc 2 §4.4, item 2.3). Enums em lowercase; valorAquisicao em
// CENTAVOS inteiros (convenção do domínio). Mapeamento para Prisma no service.
export const criarAtivoSchema = z.object({
  tipo: z.enum(['veiculo', 'outro']).default('veiculo'),
  // Homologação 04/08: VEÍCULO nasce com a estrutura jurídica DONA (tag) —
  // obrigatória no refine abaixo. Ativo OUTRO (interno, ex.: crédito avulso)
  // dispensa.
  estruturaJuridicaId: z.string().trim().min(1).optional(),
  // variante do Catálogo de Produtos (F2): define os parâmetros da simulação
  varianteCatalogo: z.enum(['carro', 'moto', 'outro']).optional(),
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
  // oferta fixa desenhada (Doc 2 §4-A.3) — seletor no cadastro
  ofertaFixaId: z.string().trim().min(1).nullish(),
  // Cadastro UNIFICADO (doc 02 §19, 12/09): a estrutura é a origem do capital —
  // o operador informa os NÚMEROS do aporte junto do cadastro e a Origem de
  // Capital nasce vinculada à mesma estrutura do ativo. Opcional (pode ser
  // registrada depois pela tela do ativo, como antes).
  aporte: z
    .object({
      tipo: z.enum(['capital_proprio', 'emprestimo', 'investidor_ativo', 'fundo']).default('capital_proprio'),
      valorAportado: z.coerce.number().int().min(0),
      taxaRetorno: z.coerce.number().min(0).optional(),
      dataAporte: z.coerce.date(),
    })
    .optional(),
}).superRefine((data, ctx) => {
  if (data.tipo !== 'outro' && !data.estruturaJuridicaId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['estruturaJuridicaId'],
      message: 'Vincule a estrutura jurídica dona do ativo — todo veículo pertence a exatamente uma',
    });
  }
});

export type CriarAtivoDto = z.infer<typeof criarAtivoSchema>;
