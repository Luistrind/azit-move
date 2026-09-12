-- Estrutura Jurídica como base de todos os produtos (doc 02 §19, decisão 12/09):
-- produto declara a estrutura dona; Reembolso Parcelado deixa de criar Ativo
-- sintético e Origem de Capital fictícia (contrato sem ativo; recebível sem
-- origem pertence à estrutura do produto). Dados sintéticos são de TESTE
-- (autorização Luís 12/09) e saem na limpeza abaixo.

-- 1. Produto do Catálogo ganha a estrutura dona.
ALTER TABLE "produtos_catalogo" ADD COLUMN "estruturaJuridicaId" TEXT;
ALTER TABLE "produtos_catalogo" ADD CONSTRAINT "produtos_catalogo_estruturaJuridicaId_fkey"
  FOREIGN KEY ("estruturaJuridicaId") REFERENCES "estruturas_juridicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Contrato pode viver sem ativo (RP é obrigação da conta).
ALTER TABLE "contratos_credito" ALTER COLUMN "ativoId" DROP NOT NULL;

-- 3. Recebível pode viver sem origem de capital (lastro = estrutura do produto).
ALTER TABLE "recebiveis" ALTER COLUMN "origemCapitalId" DROP NOT NULL;

-- 4. Limpeza dos sintéticos de teste: solta os vínculos e remove.
UPDATE "recebiveis" SET "origemCapitalId" = NULL
  WHERE "origemCapitalId" IN (
    SELECT oc.id FROM "origens_capital" oc
    JOIN "ativos" a ON a.id = oc."ativoId"
    WHERE a.tipo = 'OUTRO');
UPDATE "titulos_pagar" SET "ativoId" = NULL
  WHERE "ativoId" IN (SELECT id FROM "ativos" WHERE tipo = 'OUTRO');
UPDATE "contratos_credito" SET "ativoId" = NULL
  WHERE "ativoId" IN (SELECT id FROM "ativos" WHERE tipo = 'OUTRO');
DELETE FROM "origens_capital"
  WHERE "ativoId" IN (SELECT id FROM "ativos" WHERE tipo = 'OUTRO');
UPDATE "ativos" SET "deletedAt" = now()
  WHERE tipo = 'OUTRO' AND "deletedAt" IS NULL;
