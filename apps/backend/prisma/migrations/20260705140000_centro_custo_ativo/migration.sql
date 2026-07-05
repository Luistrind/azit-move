-- Centro de custo do ativo (Doc 2 §4.4-A, Decisão 2026-07-05): lançamentos de
-- custo por veículo. Receita é calculada em runtime. Migration ADITIVA.
CREATE TABLE "lancamentos_custo_ativo" (
    "id" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lancamentos_custo_ativo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lancamentos_custo_ativo_ativoId_idx" ON "lancamentos_custo_ativo"("ativoId");
ALTER TABLE "lancamentos_custo_ativo" ADD CONSTRAINT "lancamentos_custo_ativo_ativoId_fkey"
  FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
