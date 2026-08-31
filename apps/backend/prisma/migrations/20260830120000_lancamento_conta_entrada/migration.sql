-- Entrada deixa de ser "fatura sintética" e vira LANÇAMENTO da conta
-- (doc 02 §4-A.3, revisão 2026-08-30 — solução da fatura sintética rejeitada
-- em homologação). Cria a tabela, CONVERTE as faturas sintéticas existentes
-- (fatura PAGA com item de tipo ENTRADA) em lançamentos e as remove da régua.

-- 1. Enum + tabela
CREATE TYPE "TipoLancamentoConta" AS ENUM ('ENTRADA_CONTRATO', 'ENTRADA_ACORDO');

CREATE TABLE "lancamentos_conta" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "contratoId" TEXT,
    "acordoId" TEXT,
    "tipo" "TipoLancamentoConta" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "dataPagamento" TIMESTAMP(3) NOT NULL,
    "asaasChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lancamentos_conta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lancamentos_conta_contaId_idx" ON "lancamentos_conta"("contaId");
CREATE INDEX "lancamentos_conta_contratoId_idx" ON "lancamentos_conta"("contratoId");
CREATE INDEX "lancamentos_conta_acordoId_idx" ON "lancamentos_conta"("acordoId");

ALTER TABLE "lancamentos_conta" ADD CONSTRAINT "lancamentos_conta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lancamentos_conta" ADD CONSTRAINT "lancamentos_conta_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lancamentos_conta" ADD CONSTRAINT "lancamentos_conta_acordoId_fkey" FOREIGN KEY ("acordoId") REFERENCES "acordos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Conversão de dados: cada fatura sintética de entrada (fatura com item
--    ENTRADA e sem parcelas) vira um lançamento ENTRADA_CONTRATO. O contrato é
--    resolvido pelo asaasChargeId da cobrança da entrada; se não houver, pelo
--    dia zero (entradaPagaEm) na mesma conta.
INSERT INTO "lancamentos_conta" ("id", "contaId", "contratoId", "tipo", "descricao", "valor", "dataPagamento", "asaasChargeId", "createdAt", "updatedAt")
SELECT
    substr(md5(f."id" || 'lancamento'), 1, 25),
    f."contaId",
    COALESCE(
        (SELECT c1."id" FROM "contratos_credito" c1
         WHERE c1."entradaCobrancaAsaasId" IS NOT NULL AND c1."entradaCobrancaAsaasId" = f."asaasChargeId" LIMIT 1),
        (SELECT c2."id" FROM "contratos_credito" c2
         WHERE c2."contaId" = f."contaId" AND c2."entradaPagaEm" IS NOT NULL
         ORDER BY abs(extract(epoch FROM (c2."entradaPagaEm" - f."dataPagamento"))) ASC LIMIT 1)
    ),
    'ENTRADA_CONTRATO'::"TipoLancamentoConta",
    i."descricao",
    i."valor",
    COALESCE(f."dataPagamento", f."createdAt"),
    f."asaasChargeId",
    f."createdAt",
    CURRENT_TIMESTAMP
FROM "faturas" f
JOIN "itens_fatura" i ON i."faturaId" = f."id" AND i."tipo" = 'ENTRADA';

-- 3. Remove as faturas sintéticas convertidas (itens primeiro, por FK). Elas
--    não têm parcelas — eram só o veículo de exibição da entrada, agora
--    preservada integralmente em lancamentos_conta.
DELETE FROM "itens_fatura" WHERE "faturaId" IN (
    SELECT f."id" FROM "faturas" f
    JOIN "itens_fatura" i ON i."faturaId" = f."id" AND i."tipo" = 'ENTRADA'
);
DELETE FROM "faturas" WHERE "id" IN (
    SELECT "id" FROM "faturas" fx
    WHERE NOT EXISTS (SELECT 1 FROM "itens_fatura" ix WHERE ix."faturaId" = fx."id")
      AND NOT EXISTS (SELECT 1 FROM "parcelas" px WHERE px."faturaId" = fx."id")
      AND fx."status" = 'PAGA'
      AND EXISTS (SELECT 1 FROM "lancamentos_conta" lx WHERE lx."id" = substr(md5(fx."id" || 'lancamento'), 1, 25))
);
