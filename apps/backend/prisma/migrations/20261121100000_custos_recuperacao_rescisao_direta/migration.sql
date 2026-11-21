-- Custos da recuperação, rescisão direta e boleto único do saldo (doc 02 §29.3,
-- decisões Luís 20–21/11/2026). Tudo aditivo: nenhuma linha existente muda de
-- sentido (custo sem contrato continua custo comum do veículo; rescisão antiga
-- fica com custos e multas zerados e origem RETOMADA).

-- CreateEnum
CREATE TYPE "OrigemRescisao" AS ENUM ('RETOMADA', 'DEVOLUCAO');
CREATE TYPE "SituacaoCusto" AS ENUM ('ORCADO', 'PAGO');
CREATE TYPE "QuemPagaCusto" AS ENUM ('CLIENTE', 'AZIT');

-- AlterEnum
ALTER TYPE "TipoLancamentoConta" ADD VALUE 'SALDO_RESCISAO';

-- AlterTable: custo do veículo ligado ao contrato
ALTER TABLE "lancamentos_custo_ativo"
  ADD COLUMN "contratoId" TEXT,
  ADD COLUMN "situacao" "SituacaoCusto",
  ADD COLUMN "quemPaga" "QuemPagaCusto",
  ADD COLUMN "fornecedor" TEXT,
  ADD COLUMN "comprovanteRef" TEXT,
  ADD COLUMN "comprovanteNome" TEXT;
CREATE INDEX "lancamentos_custo_ativo_contratoId_idx" ON "lancamentos_custo_ativo"("contratoId");
ALTER TABLE "lancamentos_custo_ativo" ADD CONSTRAINT "lancamentos_custo_ativo_contratoId_fkey"
  FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: rescisão
ALTER TABLE "rescisoes_contrato"
  ADD COLUMN "origem" "OrigemRescisao" NOT NULL DEFAULT 'RETOMADA',
  ADD COLUMN "custosCliente" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "multasVeiculo" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "ajustesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "cobrancaChargeId" TEXT,
  ADD COLUMN "cobrancaValor" DECIMAL(12,2),
  ADD COLUMN "cobrancaVencimento" TIMESTAMP(3),
  ADD COLUMN "cobrancaEmitidaEm" TIMESTAMP(3),
  ADD COLUMN "cobrancaLink" TEXT,
  ADD COLUMN "cobrancaVencidaEm" TIMESTAMP(3),
  ADD COLUMN "saldoPagoEm" TIMESTAMP(3),
  ADD COLUMN "saldoValorPago" DECIMAL(12,2);

-- AlterTable: ocorrência repassada pelo acerto da rescisão
ALTER TABLE "ocorrencias_veiculo" ADD COLUMN "rescisaoId" TEXT;
CREATE INDEX "ocorrencias_veiculo_rescisaoId_idx" ON "ocorrencias_veiculo"("rescisaoId");
ALTER TABLE "ocorrencias_veiculo" ADD CONSTRAINT "ocorrencias_veiculo_rescisaoId_fkey"
  FOREIGN KEY ("rescisaoId") REFERENCES "rescisoes_contrato"("id") ON DELETE SET NULL ON UPDATE CASCADE;
