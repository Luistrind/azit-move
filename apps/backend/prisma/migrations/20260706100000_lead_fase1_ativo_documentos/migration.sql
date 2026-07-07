-- Fase 1 do atendimento (telefone no Lead + canais reais) + central de documentos
-- do veículo (Doc 2 §4-A.1 e §4.4-A). Migration ADITIVA.

-- 1) Novos canais de origem (reunião 04/07: OLX, WhatsApp, Instagram/Meta, indicação).
ALTER TYPE "CanalOrigem" ADD VALUE IF NOT EXISTS 'OLX';
ALTER TYPE "CanalOrigem" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "CanalOrigem" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE "CanalOrigem" ADD VALUE IF NOT EXISTS 'INDICACAO';

-- 2) Telefone no Lead (fase 1).
ALTER TABLE "leads" ADD COLUMN "telefone" TEXT;

-- 3) Documentos do veículo (baixáveis).
CREATE TABLE "ativo_documentos" (
    "id" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "arquivoRef" TEXT NOT NULL,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ativo_documentos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ativo_documentos_ativoId_idx" ON "ativo_documentos"("ativoId");
ALTER TABLE "ativo_documentos" ADD CONSTRAINT "ativo_documentos_ativoId_fkey"
  FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
