-- Doc 02 §31 (decisão Luís 2026-11-03): aprovação por veículo de referência (FIPE),
-- lista de espera, estado Reservado do ativo e conferência do carro real pela análise.

ALTER TYPE "StatusAtivo" ADD VALUE IF NOT EXISTS 'RESERVADO';

CREATE TABLE "veiculos_referencia" (
    "id" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "anoModelo" INTEGER NOT NULL,
    "combustivel" TEXT,
    "fipeCodigo" TEXT,
    "valorFipe" DECIMAL(12,2) NOT NULL,
    "fipeReferencia" TEXT NOT NULL,
    "consultadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "veiculos_referencia_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "simulacoes" ADD COLUMN "referenciaId" TEXT;
ALTER TABLE "simulacoes" ADD CONSTRAINT "simulacoes_referenciaId_fkey" FOREIGN KEY ("referenciaId") REFERENCES "veiculos_referencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "propostas" ALTER COLUMN "ativoId" DROP NOT NULL;
ALTER TABLE "propostas" ADD COLUMN "referenciaId" TEXT;
ALTER TABLE "propostas" ADD COLUMN "veiculoAtribuidoEm" TIMESTAMP(3);
ALTER TABLE "propostas" ADD COLUMN "veiculoConferidoEm" TIMESTAMP(3);
ALTER TABLE "propostas" ADD COLUMN "veiculoConferidoPorId" TEXT;
ALTER TABLE "propostas" ADD COLUMN "conferenciaVeiculo" JSONB;
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_referenciaId_fkey" FOREIGN KEY ("referenciaId") REFERENCES "veiculos_referencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ativos" ADD COLUMN "reservadoPropostaId" TEXT;
ALTER TABLE "ativos" ADD COLUMN "reservadoEm" TIMESTAMP(3);
ALTER TABLE "ativos" ADD CONSTRAINT "ativos_reservadoPropostaId_fkey" FOREIGN KEY ("reservadoPropostaId") REFERENCES "propostas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
