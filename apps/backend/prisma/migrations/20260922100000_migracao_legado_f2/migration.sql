-- Migracao do legado F2 (doc 02 sec.26.7): termos do contrato, PDF,
-- interpretacao das cobrancas e conciliacao. Somente ADITIVA.
ALTER TABLE "casos_migracao_legado"
  ADD COLUMN "termos" JSONB,
  ADD COLUMN "termosAtualizadosEm" TIMESTAMP(3),
  ADD COLUMN "contratoPdfRef" TEXT,
  ADD COLUMN "contratoPdfNome" TEXT,
  ADD COLUMN "contratoPdfEm" TIMESTAMP(3),
  ADD COLUMN "extracaoPdf" JSONB,
  ADD COLUMN "divergenciasReconhecidas" JSONB,
  ADD COLUMN "validadoEm" TIMESTAMP(3),
  ADD COLUMN "validadoPor" TEXT;

ALTER TABLE "cobrancas_legadas"
  ADD COLUMN "valorOriginal" DECIMAL(12,2),
  ADD COLUMN "encargoPago" DECIMAL(12,2),
  ADD COLUMN "tipoInterpretado" TEXT,
  ADD COLUMN "interpretacao" JSONB,
  ADD COLUMN "interpretadoPor" TEXT,
  ADD COLUMN "interpretadoEm" TIMESTAMP(3),
  ADD COLUMN "duvida" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "interpretacaoObs" TEXT;
