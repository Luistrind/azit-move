-- Novação CONTA-cêntrica (F2 — doc adaptações 13/09, reformulação 14/09).
-- A tabela novacoes estava VAZIA em todos os ambientes (o produto nunca foi
-- contratado); a reformulação troca o par 1:1 origem→novo por conta + dois
-- contratos novos (veículo/termo) + N contratos de origem extintos.

-- Estados de novação nas obrigações de origem (ativação atômica)
ALTER TYPE "StatusAcordo" ADD VALUE IF NOT EXISTS 'NOVADO';
ALTER TYPE "StatusFatura" ADD VALUE IF NOT EXISTS 'NOVADA';
ALTER TYPE "StatusParcela" ADD VALUE IF NOT EXISTS 'NOVADA';

-- Estados novos do fluxo da novação
ALTER TYPE "StatusNovacao" ADD VALUE IF NOT EXISTS 'AGUARDANDO_ASSINATURA';
ALTER TYPE "StatusNovacao" ADD VALUE IF NOT EXISTS 'AGUARDANDO_RECEBIMENTO';
ALTER TYPE "StatusNovacao" ADD VALUE IF NOT EXISTS 'EXPIRADO';

-- novacoes: remove o desenho 1:1 antigo
ALTER TABLE "novacoes" DROP CONSTRAINT IF EXISTS "novacoes_contratoOrigemId_fkey";
ALTER TABLE "novacoes" DROP CONSTRAINT IF EXISTS "novacoes_contratoNovoId_fkey";
DROP INDEX IF EXISTS "novacoes_contratoOrigemId_key";
DROP INDEX IF EXISTS "novacoes_contratoNovoId_key";
ALTER TABLE "novacoes"
  DROP COLUMN IF EXISTS "contratoOrigemId",
  DROP COLUMN IF EXISTS "contratoNovoId",
  DROP COLUMN IF EXISTS "dataEfetivacao",
  DROP COLUMN IF EXISTS "saldoLiquidado";

-- novacoes: desenho conta-cêntrico
ALTER TABLE "novacoes"
  ADD COLUMN "contaId" TEXT NOT NULL,
  ADD COLUMN "snapshotJson" JSONB,
  ADD COLUMN "saldoVeiculo" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "saldoDemais" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "valorParcela" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "recebimentoInicial" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "asaasChargeIdRecebimento" TEXT,
  ADD COLUMN "contratoVeiculoId" TEXT,
  ADD COLUMN "contratoTermoId" TEXT,
  ADD COLUMN "dataAssinatura" TIMESTAMP(3),
  ADD COLUMN "dataAtivacao" TIMESTAMP(3);

CREATE UNIQUE INDEX "novacoes_contratoVeiculoId_key" ON "novacoes"("contratoVeiculoId");
CREATE UNIQUE INDEX "novacoes_contratoTermoId_key" ON "novacoes"("contratoTermoId");
CREATE INDEX "novacoes_contaId_idx" ON "novacoes"("contaId");
CREATE INDEX "novacoes_status_idx" ON "novacoes"("status");

ALTER TABLE "novacoes" ADD CONSTRAINT "novacoes_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "novacoes" ADD CONSTRAINT "novacoes_contratoVeiculoId_fkey"
  FOREIGN KEY ("contratoVeiculoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "novacoes" ADD CONSTRAINT "novacoes_contratoTermoId_fkey"
  FOREIGN KEY ("contratoTermoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- contratos_credito: vínculo do contrato de origem extinto com a novação
ALTER TABLE "contratos_credito" ADD COLUMN "novacaoOrigemId" TEXT;
ALTER TABLE "contratos_credito" ADD CONSTRAINT "contratos_credito_novacaoOrigemId_fkey"
  FOREIGN KEY ("novacaoOrigemId") REFERENCES "novacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
