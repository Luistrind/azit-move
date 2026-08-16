-- Doc 02 sec.17 (2026-08-16): flag de contratacao avulsa no Catalogo — o modal
-- "+ Contratar credito" passa a listar SO o Catalogo (nunca o Produto legado).
ALTER TABLE "produtos_catalogo" ADD COLUMN "contratacaoAvulsa" BOOLEAN NOT NULL DEFAULT false;

-- Reembolso Parcelado e o produto avulso vigente (F3).
UPDATE "produtos_catalogo" SET "contratacaoAvulsa" = true WHERE "chave" = 'reembolso_parcelado';
