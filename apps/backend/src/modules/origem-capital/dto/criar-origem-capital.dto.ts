import { z } from 'zod';

// Registro da origem de capital de um ativo (Doc 2 §4.5, item 2.4). 1:1 com Ativo.
// valorAportado em CENTAVOS; taxaRetorno é fração decimal; dataAporte ISO.
// contratoInvestimentoId só se aplica a investidor_ativo/fundo — entidade de bloco
// futuro, FK opcional e não validada aqui além da constraint do banco.
export const criarOrigemCapitalSchema = z.object({
  tipo: z.enum(['capital_proprio', 'emprestimo', 'investidor_ativo', 'fundo']),
  contratoInvestimentoId: z.string().min(1).optional(),
  // Doc 02 (2026-08-18): a Origem de Capital é o VÍNCULO ativo→fonte de capital.
  // valorAportado/taxaRetorno são LEGADO (aporte e retorno vivem na camada de
  // capital: estrutura jurídica + mútuo) — aceitos por compat, default 0.
  valorAportado: z.coerce.number().int().min(0).default(0),
  taxaRetorno: z.coerce.number().min(0).max(1).optional(),
  dataAporte: z.coerce.date(),
});

export type CriarOrigemCapitalDto = z.infer<typeof criarOrigemCapitalSchema>;
