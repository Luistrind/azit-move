-- Doc 02 §25.8 (decisão Luís 2026-11-24): status Em preparação e checklist do
-- veículo antes da venda (carro novo, recuperado ou em manutenção).

ALTER TYPE "StatusAtivo" ADD VALUE IF NOT EXISTS 'EM_PREPARACAO';

CREATE TYPE "MotivoPreparacao" AS ENUM ('ENTRADA', 'RECUPERACAO', 'MANUTENCAO');
CREATE TYPE "SituacaoItemPreparacao" AS ENUM ('FEITO', 'NAO_SE_APLICA');

CREATE TABLE "preparacoes_ativo" (
    "id" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "motivo" "MotivoPreparacao" NOT NULL,
    "oQueFalta" TEXT,
    "abertaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abertaPor" TEXT,
    "concluidaEm" TIMESTAMP(3),
    "concluidaPor" TEXT,
    CONSTRAINT "preparacoes_ativo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "preparacoes_ativo_ativoId_idx" ON "preparacoes_ativo"("ativoId");
ALTER TABLE "preparacoes_ativo" ADD CONSTRAINT "preparacoes_ativo_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "preparacao_itens" (
    "id" TEXT NOT NULL,
    "preparacaoId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "avulso" BOOLEAN NOT NULL DEFAULT false,
    "situacao" "SituacaoItemPreparacao",
    "marcadoEm" TIMESTAMP(3),
    "marcadoPor" TEXT,
    CONSTRAINT "preparacao_itens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "preparacao_itens_preparacaoId_idx" ON "preparacao_itens"("preparacaoId");
ALTER TABLE "preparacao_itens" ADD CONSTRAINT "preparacao_itens_preparacaoId_fkey" FOREIGN KEY ("preparacaoId") REFERENCES "preparacoes_ativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "checklist_preparacao_modelo" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "checklist_preparacao_modelo_pkey" PRIMARY KEY ("id")
);

-- Padrão provisório (Regra 12) — o Luís citou estes itens em 24/11; editável na tela.
INSERT INTO "checklist_preparacao_modelo" ("id", "descricao", "ordem") VALUES
  ('chk_oleo_filtro', 'Troca de óleo e filtro', 1),
  ('chk_rastreador', 'Instalação do rastreador', 2),
  ('chk_vip', 'VIP', 3);
