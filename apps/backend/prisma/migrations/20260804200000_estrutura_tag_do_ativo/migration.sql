-- Homologacao 04/08: Estrutura Juridica como TAG do ativo (1 estrutura : N ativos).
ALTER TABLE "ativos" ADD COLUMN "estruturaJuridicaId" TEXT;
ALTER TABLE "ativos" ADD CONSTRAINT "ativos_estruturaJuridicaId_fkey"
  FOREIGN KEY ("estruturaJuridicaId") REFERENCES "estruturas_juridicas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ativos_estruturaJuridicaId_idx" ON "ativos"("estruturaJuridicaId");
