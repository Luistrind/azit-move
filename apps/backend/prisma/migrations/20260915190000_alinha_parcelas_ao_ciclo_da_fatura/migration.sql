-- Alinha parcelas ao ciclo da fatura (correcao 15/09 — caso real Arthur, RP
-- 2026090003): produto adicional nascia com vencimento "hoje + passo" fora do
-- dia das faturas da conta; o consolidador cobrava a parcela na fatura do
-- ciclo SEGUINTE e a parcela "vencia" com a fatura dela ainda em aberto
-- (status contraditorios, regua/mora errados). A regra nova alinha na
-- ativacao; esta migracao corrige o legado: parcela EM ABERTO cuja fatura
-- (nao paga) vence em data diferente passa a vencer NA data da fatura que a
-- cobra. Valores intactos; recebiveis acompanham; a dataPrimeiraParcela do
-- contrato reflete o novo cronograma. Idempotente por construcao.

-- 1. Parcelas em aberto desalinhadas da fatura que as cobra.
UPDATE "parcelas" p
SET "dataVencimento" = f."dataVencimento"
FROM "faturas" f
WHERE p."faturaId" = f.id
  AND p.status IS NULL
  AND f.status IN ('ABERTA', 'FECHADA')
  AND p."dataVencimento" <> f."dataVencimento";

-- 2. Recebiveis esperados acompanham a nova data da parcela.
UPDATE "recebiveis" r
SET "dataPrevista" = p."dataVencimento"
FROM "parcelas" p
WHERE r."parcelaId" = p.id
  AND r.status = 'ESPERADO'
  AND p.status IS NULL
  AND r."dataPrevista" <> p."dataVencimento";

-- 3. dataPrimeiraParcela do contrato = menor vencimento do cronograma dele
--    (so contratos que possuem parcelas e ficaram com o campo defasado).
UPDATE "contratos_credito" c
SET "dataPrimeiraParcela" = m.primeira
FROM (
  SELECT "contratoId", MIN("dataVencimento") AS primeira
  FROM "parcelas"
  GROUP BY "contratoId"
) m
WHERE m."contratoId" = c.id
  AND c."dataPrimeiraParcela" <> m.primeira;
