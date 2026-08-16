-- Entrada materializada (doc 02 sec.4-A.3, decisao 2026-08-16): a entrada paga
-- vira registro interno — campos no contrato + item de fatura tipo ENTRADA.
ALTER TYPE "TipoItemFatura" ADD VALUE IF NOT EXISTS 'ENTRADA';

ALTER TABLE "contratos_credito"
  ADD COLUMN "entradaCobrancaAsaasId" TEXT,
  ADD COLUMN "entradaPagaEm" TIMESTAMP(3),
  ADD COLUMN "valorEntradaPago" DECIMAL(12,2);
