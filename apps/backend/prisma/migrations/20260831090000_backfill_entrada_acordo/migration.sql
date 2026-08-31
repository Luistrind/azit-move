-- Backfill da entrada de ACORDOS já efetivados (doc 02 §4-A.3, revisão 2026-08-30):
-- o lançamento ENTRADA_ACORDO nasce na efetivação, mas acordos efetivados ANTES
-- desta mudança (ex.: homologação 28-30/08) ficariam sem registro — a entrada
-- paga não apareceria em lugar nenhum. Cria o lançamento retroativo para todo
-- acordo ATIVO/QUITADO com entrada > 0 que ainda não tem o seu.
INSERT INTO "lancamentos_conta" ("id", "contaId", "acordoId", "tipo", "descricao", "valor", "dataPagamento", "asaasChargeId", "createdAt", "updatedAt")
SELECT
    substr(md5(a."id" || 'entrada-acordo'), 1, 25),
    a."contaId",
    a."id",
    'ENTRADA_ACORDO'::"TipoLancamentoConta",
    'Entrada do acordo de renegociação',
    a."valorEntrada",
    COALESCE(a."dataEfetivacao", a."updatedAt"),
    a."asaasChargeIdEntrada",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "acordos" a
WHERE a."status" IN ('ATIVO', 'QUITADO')
  AND a."valorEntrada" > 0
  AND a."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "lancamentos_conta" l
    WHERE l."acordoId" = a."id" AND l."tipo" = 'ENTRADA_ACORDO'
  );
