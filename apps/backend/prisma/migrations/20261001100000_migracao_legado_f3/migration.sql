-- Migracao do legado F3 (doc 02 sec.26.5/26.9): contrato aponta o caso de origem;
-- o caso guarda o que a migracao gerou e o corte da assinatura no Asaas. ADITIVA.
ALTER TABLE "contratos_credito" ADD COLUMN "legadoCasoId" TEXT;
CREATE UNIQUE INDEX "contratos_credito_legadoCasoId_key" ON "contratos_credito"("legadoCasoId");
ALTER TABLE "casos_migracao_legado"
  ADD COLUMN "migradoEm" TIMESTAMP(3),
  ADD COLUMN "migradoPor" TEXT,
  ADD COLUMN "migracaoResumo" JSONB,
  ADD COLUMN "assinaturaParadaEm" TIMESTAMP(3),
  ADD COLUMN "assinaturaParadaErro" TEXT;
