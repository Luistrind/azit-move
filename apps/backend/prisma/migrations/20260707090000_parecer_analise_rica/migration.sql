-- Análise de crédito rica (pedido Luís 2026-07-07): observação analítica + motivos
-- de ressalva no Parecer, e anexos de embasamento da análise. Migration ADITIVA.
ALTER TYPE "TipoDocumentoProposta" ADD VALUE IF NOT EXISTS 'ANEXO_ANALISE';
ALTER TABLE "pareceres" ADD COLUMN "motivosRessalva" TEXT;
ALTER TABLE "pareceres" ADD COLUMN "observacao" TEXT;
