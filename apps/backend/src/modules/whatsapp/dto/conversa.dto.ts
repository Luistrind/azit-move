import { z } from 'zod';
import { TipoMidiaSaidaWhatsapp } from '@azit/types';

// Conversas como atendimento (doc 02 §34). O arquivo chega em base64, como nos
// demais uploads do sistema (limite de corpo do Fastify: 30 MB).

export const enviarAnexoSchema = z.object({
  tipo: z.nativeEnum(TipoMidiaSaidaWhatsapp),
  nome: z.string().trim().max(200).default(''),
  mime: z.string().trim().min(3).max(150),
  conteudoBase64: z.string().min(8),
  legenda: z.string().max(1024).optional(),
});
export type EnviarAnexoDto = z.infer<typeof enviarAnexoSchema>;

const linha = z.object({ rotulo: z.string().trim().min(1).max(120), valor: z.string().trim().min(1).max(120) });

// §34.7: o texto vai sempre; o PDF, se marcado, leva as linhas que o serviço da
// simulação devolveu à tela (o backend não refaz conta nenhuma).
export const enviarSimulacaoSchema = z.object({
  texto: z.string().min(1).max(4096),
  pdf: z
    .object({
      titulo: z.string().trim().min(3).max(120),
      destaque: linha.nullable().optional(),
      linhas: z.array(linha).min(1).max(30),
      observacoes: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
    })
    .nullable()
    .optional(),
});
export type EnviarSimulacaoDto = z.infer<typeof enviarSimulacaoSchema>;
