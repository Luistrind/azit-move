-- Resumo do assistente de analise (IA - 14/09): relatorio cadastral gerado
-- pela API do Claude; apoio ao analista, nunca decide nem transita status.
ALTER TABLE "analises_cadastro" ADD COLUMN "resumoIa" JSONB;
