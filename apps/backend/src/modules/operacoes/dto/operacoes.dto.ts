import { z } from 'zod';

// Valores monetários em CENTAVOS inteiros.

export const criarRenegociacaoSchema = z.object({
  valorEntrada: z.coerce.number().int().min(0),
  numeroParcelasNovas: z.coerce.number().int().min(1),
  // Placeholder: com o motor do Catálogo ATIVO a parcela é CALCULADA no servidor
  // (RAP031) e este campo é ignorado; sem motor, vale a divisão simples.
  valorParcelaNova: z.coerce.number().int().min(0).optional().default(0),
  periodicidade: z.enum(['semanal', 'quinzenal', 'mensal']).optional(), // ignorada com motor ativo (frequência herdada)
  // Data-limite dura da entrada (decisão 2026-08-18) — 'YYYY-MM-DD'.
  dataLimiteEntrada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Seleção por FATURA (doc Acordo de Pagamento V1.0 RAP006): excluir uma
  // fatura pré-selecionada exige justificativa textual auditável.
  faturasExcluidas: z
    .array(z.object({ faturaId: z.string().min(1), justificativa: z.string().trim().min(10, 'Justificativa da exclusão precisa de pelo menos 10 caracteres') }))
    .optional(),
  // Faturas VINCENDAS incluídas por opção do operador (decisão Luís 2026-08-30).
  faturasVincendasIncluidas: z.array(z.string().min(1)).optional(),
  // De acordo do cliente via WhatsApp (doc 02 §7.7, 2026-09-09) — obrigatório
  // no CRIAR (o service valida); ignorado na simulação.
  aceiteWhatsapp: z.boolean().optional(),
  // Dossiê da Central (21/10): mensagem enviada, resposta do cliente colada pelo
  // operador e observação para quem aprova — vão ao snapshot/observação do acordo.
  mensagemWhatsapp: z.string().trim().max(4000).optional(),
  respostaCliente: z.string().trim().max(2000).optional(),
  observacao: z.string().trim().max(2000).optional(),
});
export type CriarRenegociacaoBody = z.infer<typeof criarRenegociacaoSchema>;

export const quitacaoSchema = z.object({
  parcelaIds: z.array(z.string().min(1)).optional(),
});
export type QuitacaoBody = z.infer<typeof quitacaoSchema>;

export const sinistroSchema = z.object({
  valorIndenizacao: z.coerce.number().int().min(0),
});
export type SinistroBody = z.infer<typeof sinistroSchema>;

// Rescisão (doc 02 §29; fluxo direto §29.3, 20–21/11): data-base = dia em que o
// carro voltou; origem = retomado pela Azit ou devolvido pelo cliente.
export const rescisaoSchema = z.object({
  dataBase: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  origem: z.enum(['RETOMADA', 'DEVOLUCAO']).optional(),
  observacao: z.string().trim().max(2000).optional(),
});
export type RescisaoBody = z.infer<typeof rescisaoSchema>;

// Custo da recuperação (doc 02 §29.3): lançamento de custo do veículo ligado ao contrato.
const arquivoSchema = z.object({ nome: z.string().min(1).max(200), conteudo: z.string().min(1) });
export const custoRecuperacaoSchema = z.object({
  tipo: z.string().min(1).max(40),
  descricao: z.string().trim().min(1).max(300),
  valor: z.coerce.number().int().positive(), // centavos
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fornecedor: z.string().trim().max(120).optional(),
  situacao: z.enum(['ORCADO', 'PAGO']),
  quemPaga: z.enum(['CLIENTE', 'AZIT']),
  comprovante: arquivoSchema.optional(),
});
export type CustoRecuperacaoBody = z.infer<typeof custoRecuperacaoSchema>;
export const alterarCustoRecuperacaoSchema = custoRecuperacaoSchema.partial();
export type AlterarCustoRecuperacaoBody = z.infer<typeof alterarCustoRecuperacaoSchema>;

export const devolucaoRescisaoSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  observacao: z.string().trim().max(2000).optional(),
});
export type DevolucaoRescisaoBody = z.infer<typeof devolucaoRescisaoSchema>;

export const reajusteSchema = z.object({
  indicePercentual: z.coerce.number().min(0).max(100), // ex: 4.5 = 4,5%
});
export type ReajusteBody = z.infer<typeof reajusteSchema>;
