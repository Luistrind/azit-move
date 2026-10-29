-- Liberação da análise preenchida pelo sistema (doc 02 §14, decisão Luís 28/10/2026):
-- origem de cada preenchimento automático (renda apurada pela IA, identidade pela
-- Camada 1, CNH pelo anexo) — nulo = nunca tocado.
ALTER TABLE "participantes_analise" ADD COLUMN "rendaApuradaOrigem" TEXT;
ALTER TABLE "participantes_analise" ADD COLUMN "identidadeValidadaOrigem" TEXT;
ALTER TABLE "participantes_analise" ADD COLUMN "cnhValidaOrigem" TEXT;
