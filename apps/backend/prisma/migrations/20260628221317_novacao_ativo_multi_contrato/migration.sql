-- Novação: um ativo pode ter vários ContratoCredito no tempo (Doc 2 §4.4).
-- Remove o unique de ativoId; a regra "1 ativo = 1 contrato ATIVO" passa a ser
-- garantida em runtime (ContratoService).
DROP INDEX "contratos_credito_ativoId_key";
CREATE INDEX "contratos_credito_ativoId_idx" ON "contratos_credito"("ativoId");
