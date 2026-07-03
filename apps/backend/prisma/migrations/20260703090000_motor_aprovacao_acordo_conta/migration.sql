-- Motor de aprovação unificado + acordo conta-cêntrico (Doc 2 §7.7 e §7.9-A, Decisão 2026-07-03).
-- Migration ADITIVA com backfill — NÃO reseta dados (banco de produção tem dados de teste).

-- 1) Novo estado do acordo: aprovado pela alçada, aguardando pagamento da entrada.
ALTER TYPE "StatusAcordo" ADD VALUE 'AGUARDANDO_ENTRADA' BEFORE 'ATIVO';

-- 2) Enums do motor de aprovação.
CREATE TYPE "StatusAprovacao" AS ENUM ('PENDENTE', 'APROVADA', 'REPROVADA', 'CANCELADA');
CREATE TYPE "DecisaoAprovacao" AS ENUM ('APROVADA', 'RECOMENDADA', 'REPROVADA');

-- 3) N aprovações configurável por tipo de operação (princípio dos 4 olhos).
ALTER TABLE "tipos_operacao_alcada" ADD COLUMN "aprovacoesNecessarias" INTEGER NOT NULL DEFAULT 1;
-- Placeholder (configurável pelo admin): novação é a operação mais sensível — 2 aprovações.
UPDATE "tipos_operacao_alcada" SET "aprovacoesNecessarias" = 2 WHERE "chave" = 'novacao';

-- 4) Acordo passa a ser da CONTA; contratoId vira legado (nullable).
ALTER TABLE "acordos" ADD COLUMN "contaId" TEXT;
UPDATE "acordos" a SET "contaId" = cc."contaId" FROM "contratos_credito" cc WHERE cc."id" = a."contratoId";
ALTER TABLE "acordos" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "acordos" ALTER COLUMN "contratoId" DROP NOT NULL;
ALTER TABLE "acordos" ADD COLUMN "periodicidade" "Periodicidade" NOT NULL DEFAULT 'SEMANAL';
CREATE INDEX "acordos_contaId_idx" ON "acordos"("contaId");
ALTER TABLE "acordos" ADD CONSTRAINT "acordos_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Explosão por contrato: um acordo gera VÁRIOS itens (um por contrato afetado).
DROP INDEX "itens_contratados_acordoOrigemId_key";
CREATE INDEX "itens_contratados_acordoOrigemId_idx" ON "itens_contratados"("acordoOrigemId");

-- 6) Solicitações de aprovação + trilha de decisões.
CREATE TABLE "aprovacoes" (
    "id" TEXT NOT NULL,
    "tipoOperacao" TEXT NOT NULL,
    "referenciaTipo" TEXT NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "titularId" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "resumo" TEXT NOT NULL,
    "payload" JSONB,
    "solicitanteId" TEXT NOT NULL,
    "status" "StatusAprovacao" NOT NULL DEFAULT 'PENDENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aprovacoes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "aprovacoes_status_idx" ON "aprovacoes"("status");
CREATE INDEX "aprovacoes_referenciaTipo_referenciaId_idx" ON "aprovacoes"("referenciaTipo", "referenciaId");
CREATE INDEX "aprovacoes_titularId_idx" ON "aprovacoes"("titularId");
ALTER TABLE "aprovacoes" ADD CONSTRAINT "aprovacoes_tipoOperacao_fkey"
  FOREIGN KEY ("tipoOperacao") REFERENCES "tipos_operacao_alcada"("chave") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aprovacoes" ADD CONSTRAINT "aprovacoes_solicitanteId_fkey"
  FOREIGN KEY ("solicitanteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "aprovacao_decisoes" (
    "id" TEXT NOT NULL,
    "aprovacaoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "decisao" "DecisaoAprovacao" NOT NULL,
    "parecer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprovacao_decisoes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "aprovacao_decisoes_aprovacaoId_idx" ON "aprovacao_decisoes"("aprovacaoId");
ALTER TABLE "aprovacao_decisoes" ADD CONSTRAINT "aprovacao_decisoes_aprovacaoId_fkey"
  FOREIGN KEY ("aprovacaoId") REFERENCES "aprovacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aprovacao_decisoes" ADD CONSTRAINT "aprovacao_decisoes_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
