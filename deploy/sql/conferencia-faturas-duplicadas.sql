-- Detalhe das faturas que apontam para a MESMA cobrança do Asaas (achado do bloco
-- 7b de conferencia-carteira-mes.sql, 12/11/2026: 24 cobranças com 2 faturas cada,
-- números consecutivos e mesmo vencimento). SÓ LEITURA.
--   git show origin/fix/carteira-conferencia:deploy/sql/conferencia-faturas-duplicadas.sql \
--     | docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -f -
\pset footer off

\echo
\echo '=== A) Cada fatura dos pares: valor de face, valor pago, quando foi criada e o que tem dentro ==='
\echo '    (se as duas têm valorPago = valor da cobrança, o recebido conta em dobro; se cada uma tem só a sua parte, o teto não infla)'
WITH dup AS (
  SELECT "asaasChargeId" FROM faturas
  WHERE "deletedAt" IS NULL AND "asaasChargeId" IS NOT NULL
  GROUP BY 1 HAVING COUNT(*) > 1
)
SELECT t.nome, f."asaasChargeId" AS cobranca, f.numero AS fat, f.status,
       f."dataVencimento"::date AS venc, f."dataPagamento"::date AS pago_em,
       f."valorTotal" AS face, f."valorPago" AS pago, f."createdAt"::timestamp(0) AS criada_em,
       (SELECT STRING_AGG(COALESCE(c.numero || ' p' || p.numero, '-') || ' ' || i.tipo || ' ' || i.valor || ' "' || i.descricao || '"', ' ; ' ORDER BY i.tipo, i.valor)
          FROM itens_fatura i
          LEFT JOIN parcelas p ON p.id = i."parcelaId"
          LEFT JOIN contratos_credito c ON c.id = p."contratoId"
         WHERE i."faturaId" = f.id) AS itens
FROM faturas f
JOIN dup d       ON d."asaasChargeId" = f."asaasChargeId"
JOIN contas co   ON co.id = f."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE f."deletedAt" IS NULL
ORDER BY t.nome, f."dataVencimento", f.numero;

\echo
\echo '=== B) Soma da SEGUNDA fatura de cada par, por mês de pagamento (achado 12/11: a segunda é a INTERMEDIÁRIA da entrada diluída, dinheiro real da mesma cobrança — conta a mais só em QUANTIDADE de faturas, não em valor) ==='
WITH dup AS (
  SELECT "asaasChargeId", MIN(numero) AS primeira FROM faturas
  WHERE "deletedAt" IS NULL AND "asaasChargeId" IS NOT NULL
  GROUP BY 1 HAVING COUNT(*) > 1
)
SELECT to_char(f."dataPagamento", 'YYYY-MM') AS mes_pagamento, to_char(f."dataVencimento", 'YYYY-MM') AS mes_vencimento,
       COUNT(*) AS faturas_a_mais, SUM(COALESCE(f."valorPago", f."valorTotal")) AS valor_segunda_fatura, SUM(f."valorTotal") AS face_segunda_fatura
FROM faturas f
JOIN dup d ON d."asaasChargeId" = f."asaasChargeId" AND f.numero <> d.primeira
WHERE f."deletedAt" IS NULL
GROUP BY 1, 2
ORDER BY 1, 2;

\echo
\echo '=== C) Mesma conta, mesmo vencimento, 2+ faturas contadas (com ou sem a mesma cobrança) — o teto soma as duas ==='
SELECT t.nome, f."dataVencimento"::date AS venc, COUNT(*) AS faturas,
       STRING_AGG('fat ' || f.numero || ' ' || f.status || ' ' || f."valorTotal" || COALESCE(' ' || f."asaasChargeId", ' sem cobrança'), ' | ' ORDER BY f.numero) AS quais
FROM faturas f
JOIN contas co   ON co.id = f."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
GROUP BY 1, 2
HAVING COUNT(*) > 1
ORDER BY 2, 1;
