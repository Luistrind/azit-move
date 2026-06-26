import { z } from 'zod';

// Atualização parcial do ativo (item 2.3 / api-spec §4.9: ex. quilometragem, status).
export const atualizarAtivoSchema = z.object({
  tipo: z.enum(['veiculo', 'outro']).optional(),
  descricao: z.string().trim().min(1).optional(),
  marca: z.string().trim().nullish(),
  modelo: z.string().trim().nullish(),
  anoFabricacao: z.coerce.number().int().min(1900).max(2100).nullish(),
  anoModelo: z.coerce.number().int().min(1900).max(2100).nullish(),
  cor: z.string().trim().nullish(),
  placa: z.string().trim().min(1).nullish(),
  chassi: z.string().trim().min(1).nullish(),
  renavam: z.string().trim().nullish(),
  origem: z.enum(['locadora', 'particular', 'concessionaria']).nullish(),
  combustivel: z
    .enum(['flex', 'gasolina', 'eletrico', 'diesel', 'hibrido'])
    .nullish(),
  quilometragemEntrada: z.coerce.number().int().min(0).nullish(),
  valorAquisicao: z.coerce.number().int().min(0).nullish(),
  status: z
    .enum(['disponivel', 'em_contrato', 'quitado', 'recuperado', 'sinistrado'])
    .optional(),
});

export type AtualizarAtivoDto = z.infer<typeof atualizarAtivoSchema>;
