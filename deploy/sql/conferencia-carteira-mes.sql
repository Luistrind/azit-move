-- Conferência da Carteira (doc 02 §27) para um período. SÓ LEITURA.
-- Rodar no banco de PRODUÇÃO. Período padrão = novembro/2026; para outro trecho
-- passe -v de=AAAA-MM-DD -v ate=AAAA-MM-DD (ate é EXCLUSIVO), ex.: 1–12/out:
--   git show origin/fix/carteira-conferencia:deploy/sql/conferencia-carteira-mes.sql \
--     | docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -v de=2026-10-01 -v ate=2026-10-13 -f -
--
-- O que a tela calcula:
--   TETO = soma do valorTotal das faturas com VENCIMENTO no período, status
--          ABERTA/FECHADA/PAGA/PAGA_EM_ATRASO (NOVADA, RENEGOCIADA, RESCINDIDA fora);
--   RECEBIDO = caixa por DATA DE PAGAMENTO: faturas PAGA/PAGA_EM_ATRASO pagas no
--          período (qualquer vencimento, valorPago) + lançamentos da conta
--          (entradas de contrato e de acordo).
\if :{?de}
\else
\set de '2026-11-01'
\endif
\if :{?ate}
\else
\set ate '2026-12-01'
\endif
\pset footer off
\echo
\echo '################ Período:' :de 'até (exclusivo)' :ate '################'

\echo
\echo '=== 1) TETO — faturas com vencimento no período, por status e se têm cobrança no Asaas ==='
\echo '    (só ABERTA/FECHADA/PAGA/PAGA_EM_ATRASO entram no teto; as outras linhas mostram o que ficou de fora)'
SELECT f.status,
       (f."deletedAt" IS NOT NULL)      AS apagada,
       (f."asaasChargeId" IS NOT NULL)  AS tem_cobranca,
       COUNT(*)                         AS faturas,
       COUNT(DISTINCT f."contaId")      AS contas,
       SUM(f."valorTotal")              AS valor
FROM faturas f
WHERE f."dataVencimento" >= :'de' AND f."dataVencimento" < :'ate'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

\echo
\echo '=== 2) FALTA NO TETO? Parcelas do período de contrato ATIVO que NÃO estão numa fatura contada ==='
\echo '    (sem fatura, fatura apagada, fatura fora do teto ou fatura com vencimento de OUTRO mês)'
SELECT c.numero AS contrato, c.periodicidade, t.nome,
       COUNT(*) FILTER (WHERE p."faturaId" IS NULL)                                                                   AS sem_fatura,
       COUNT(*) FILTER (WHERE f.id IS NOT NULL AND f."deletedAt" IS NOT NULL)                                         AS fatura_apagada,
       COUNT(*) FILTER (WHERE f."deletedAt" IS NULL AND f.status NOT IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO'))  AS fatura_fora_do_teto,
       COUNT(*) FILTER (WHERE f."deletedAt" IS NULL AND (f."dataVencimento" < :'de' OR f."dataVencimento" >= :'ate'))  AS fatura_de_outro_mes,
       STRING_AGG(p.numero::text || CASE WHEN f.id IS NULL THEN '' ELSE ' (fat ' || f.numero || ' ' || f.status || ' venc ' || to_char(f."dataVencimento", 'DD/MM') || ')' END, ', ' ORDER BY p.numero) AS parcelas
FROM parcelas p
JOIN contratos_credito c ON c.id = p."contratoId"
JOIN contas co           ON co.id = c."contaId"
JOIN titulares t         ON t.id = co."titularId"
LEFT JOIN faturas f      ON f.id = p."faturaId"
WHERE p."deletedAt" IS NULL AND c."deletedAt" IS NULL AND c.status = 'ATIVO'
  AND p."acordoId" IS NULL
  AND p."dataVencimento" >= :'de' AND p."dataVencimento" < :'ate'
  AND (p."faturaId" IS NULL
       OR f."deletedAt" IS NOT NULL
       OR f.status NOT IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
       OR f."dataVencimento" < :'de' OR f."dataVencimento" >= :'ate')
GROUP BY 1, 2, 3
ORDER BY 1;

\echo
\echo '=== 2b) Contratos ATIVOS cujo cronograma atravessa o período mas NÃO têm parcela nele (buraco) ==='
SELECT c.numero AS contrato, c.periodicidade, t.nome,
       MIN(p."dataVencimento")::date AS primeira_parcela, MAX(p."dataVencimento")::date AS ultima_parcela
FROM contratos_credito c
JOIN contas co   ON co.id = c."contaId"
JOIN titulares t ON t.id = co."titularId"
JOIN parcelas p  ON p."contratoId" = c.id AND p."deletedAt" IS NULL
WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO'
GROUP BY 1, 2, 3
HAVING MIN(p."dataVencimento") < :'ate' AND MAX(p."dataVencimento") >= :'de'
   AND COUNT(*) FILTER (WHERE p."dataVencimento" >= :'de' AND p."dataVencimento" < :'ate') = 0
ORDER BY 1;

\echo
\echo '=== 3) SOBRA NO TETO? Faturas ABERTA/FECHADA do período ligadas a contrato que NÃO está ATIVO ==='
SELECT DISTINCT c.numero AS contrato, c.status AS status_contrato, c."motivoEncerramento",
       f.numero AS fatura, f.status AS status_fatura, f."dataVencimento"::date AS venc, f."valorTotal", f."asaasChargeId"
FROM faturas f
JOIN parcelas p          ON p."faturaId" = f.id
JOIN contratos_credito c ON c.id = p."contratoId"
WHERE f."deletedAt" IS NULL
  AND f.status IN ('ABERTA','FECHADA')
  AND f."dataVencimento" >= :'de' AND f."dataVencimento" < :'ate'
  AND c.status <> 'ATIVO'
ORDER BY 1, 6;

\echo
\echo '=== 3b) Contas com mais fatura no período do que a periodicidade explica, ou com 2+ contratos ==='
\echo '    (semanal = até 5 em mês de 5 segundas; acima disso, ou 2 contratos, confira se não há fatura em dobro)'
WITH fat AS (
  SELECT f.id, f."contaId", f."valorTotal",
         (SELECT STRING_AGG(DISTINCT c.numero || ' (' || c.status || '/' || c.periodicidade || ')', ', ')
            FROM parcelas p JOIN contratos_credito c ON c.id = p."contratoId" WHERE p."faturaId" = f.id) AS contratos,
         (SELECT COUNT(DISTINCT p."contratoId") FROM parcelas p WHERE p."faturaId" = f.id) AS n_contratos
  FROM faturas f
  WHERE f."deletedAt" IS NULL
    AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
    AND f."dataVencimento" >= :'de' AND f."dataVencimento" < :'ate'
)
SELECT t.nome, COUNT(*) AS faturas_no_periodo, SUM(fat."valorTotal") AS valor,
       STRING_AGG(DISTINCT fat.contratos, ' + ') AS contratos
FROM fat
JOIN contas co   ON co.id = fat."contaId"
JOIN titulares t ON t.id = co."titularId"
GROUP BY t.nome
HAVING COUNT(*) > 5 OR COUNT(DISTINCT fat.contratos) > 1 OR MAX(fat.n_contratos) > 1
ORDER BY 2 DESC, 1;

\echo
\echo '=== 4) VENCIDAS do período (bater com o cartão Vencidas do Asaas no mesmo filtro) ==='
\echo '    sem cobrança = vencida só no sistema (Asaas nunca viu); com cobrança = conferir no Asaas se já está paga (webhook perdido) ou foi alterada no painel'
SELECT t.nome, f.numero, f."dataVencimento"::date AS venc, f."valorTotal", f."valorPago" AS pago_parcial, f.status, f."asaasChargeId"
FROM faturas f
JOIN contas co   ON co.id = f."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE f."deletedAt" IS NULL
  AND f.status IN ('ABERTA','FECHADA')
  AND f."dataVencimento" >= :'de' AND f."dataVencimento" < LEAST(:'ate'::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
ORDER BY f."asaasChargeId" NULLS FIRST, t.nome, venc;

\echo
\echo '=== 5) RECEBIDO no período, por origem e se passou pelo Asaas ==='
\echo '    O Asaas só pode ter o que está em tem_cobranca = t. Tudo com tem_cobranca = f é "só no sistema".'
WITH caixa AS (
  SELECT f."contaId",
         CASE WHEN f."dataVencimento" >= :'de' AND f."dataVencimento" < :'ate' THEN '1 fatura do período' ELSE '2 fatura de outro vencimento' END AS origem,
         (f."asaasChargeId" IS NOT NULL) AS tem_cobranca,
         COALESCE(f."valorPago", f."valorTotal") AS valor, f."valorTotal" AS valor_de_face
  FROM faturas f
  WHERE f."deletedAt" IS NULL AND f.status IN ('PAGA','PAGA_EM_ATRASO')
    AND f."dataPagamento" >= :'de' AND f."dataPagamento" < :'ate'
  UNION ALL
  SELECT l."contaId",
         CASE l.tipo WHEN 'ENTRADA_ACORDO' THEN '4 entrada de acordo' ELSE '3 entrada de contrato' END,
         (l."asaasChargeId" IS NOT NULL), l.valor, NULL
  FROM lancamentos_conta l
  WHERE l."dataPagamento" >= :'de' AND l."dataPagamento" < :'ate'
)
SELECT origem, tem_cobranca, COUNT(*) AS recebimentos, COUNT(DISTINCT "contaId") AS contas,
       SUM(valor) AS recebido, SUM(valor_de_face) AS valor_de_face
FROM caixa
GROUP BY ROLLUP (origem, tem_cobranca)
ORDER BY origem NULLS LAST, tem_cobranca NULLS LAST;

\echo
\echo '=== 6) RECEBIDO SEM COBRANÇA — lista do que entrou no período sem passar pelo Asaas ==='
\echo '    (quitação antecipada / sinistro / declaração do legado / entrada paga por fora — confira um a um se o dinheiro entrou de fato)'
SELECT 'fatura ' || f.numero AS o_que, t.nome, f."dataVencimento"::date AS venc, f."dataPagamento"::date AS pago_em,
       f."valorTotal" AS valor_de_face, COALESCE(f."valorPago", f."valorTotal") AS recebido, f.status::text AS status
FROM faturas f
JOIN contas co   ON co.id = f."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE f."deletedAt" IS NULL AND f.status IN ('PAGA','PAGA_EM_ATRASO') AND f."asaasChargeId" IS NULL
  AND f."dataPagamento" >= :'de' AND f."dataPagamento" < :'ate'
UNION ALL
SELECT 'entrada: ' || l.descricao, t.nome, NULL, l."dataPagamento"::date, NULL, l.valor, l.tipo::text
FROM lancamentos_conta l
JOIN contas co   ON co.id = l."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE l."asaasChargeId" IS NULL
  AND l."dataPagamento" >= :'de' AND l."dataPagamento" < :'ate'
ORDER BY 2, 4;

\echo
\echo '=== 7) DUPLICIDADE? Mesma conta, mesmo dia, mesmo valor recebido 2+ vezes (fatura × fatura ou fatura × entrada) ==='
WITH caixa AS (
  SELECT f."contaId", f."dataPagamento"::date AS dia, COALESCE(f."valorPago", f."valorTotal") AS valor,
         'fatura ' || f.numero || ' venc ' || to_char(f."dataVencimento", 'DD/MM') || COALESCE(' ' || f."asaasChargeId", ' sem cobrança') AS rotulo
  FROM faturas f
  WHERE f."deletedAt" IS NULL AND f.status IN ('PAGA','PAGA_EM_ATRASO')
    AND f."dataPagamento" >= :'de' AND f."dataPagamento" < :'ate'
  UNION ALL
  SELECT l."contaId", l."dataPagamento"::date, l.valor, l.descricao || COALESCE(' ' || l."asaasChargeId", ' sem cobrança')
  FROM lancamentos_conta l
  WHERE l."dataPagamento" >= :'de' AND l."dataPagamento" < :'ate'
)
SELECT t.nome, x.dia, x.valor, COUNT(*) AS vezes, STRING_AGG(x.rotulo, ' | ') AS o_que
FROM caixa x
JOIN contas co   ON co.id = x."contaId"
JOIN titulares t ON t.id = co."titularId"
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
ORDER BY 2, 1;

\echo
\echo '=== 7b) Mesma cobrança do Asaas apontada por 2+ registros (fatura ou entrada) — em toda a base ==='
SELECT x."asaasChargeId", COUNT(*) AS registros, STRING_AGG(x.rotulo, ' | ') AS onde
FROM (
  SELECT f."asaasChargeId", 'fatura ' || f.numero || ' ' || f.status || ' venc ' || to_char(f."dataVencimento", 'DD/MM/YY') AS rotulo
  FROM faturas f WHERE f."deletedAt" IS NULL AND f."asaasChargeId" IS NOT NULL
  UNION ALL
  SELECT l."asaasChargeId", 'entrada ' || l.descricao FROM lancamentos_conta l WHERE l."asaasChargeId" IS NOT NULL
) x
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY 2 DESC;

\echo
\echo '=== 8) HORÁRIO gravado nas datas (toda a base). Hora UTC 0–2 = gravada entre 21h e 23h59 do Brasil ==='
\echo '    do dia ANTERIOR: a visão conta no dia seguinte ao do pagamento real (vira o mês na virada do dia).'
SELECT coluna, hora_utc, COUNT(*) AS registros FROM (
  SELECT 'faturas.dataVencimento' AS coluna, EXTRACT(HOUR FROM "dataVencimento")::int AS hora_utc FROM faturas WHERE "deletedAt" IS NULL
  UNION ALL
  SELECT 'faturas.dataPagamento', EXTRACT(HOUR FROM "dataPagamento")::int FROM faturas WHERE "deletedAt" IS NULL AND "dataPagamento" IS NOT NULL
  UNION ALL
  SELECT 'lancamentos_conta.dataPagamento', EXTRACT(HOUR FROM "dataPagamento")::int FROM lancamentos_conta
) h
GROUP BY 1, 2
ORDER BY 1, 2;

\echo
\echo '=== 9) O que o Asaas consegue enxergar hoje do período: faturas já fechadas (com cobrança) × ainda sem cobrança ==='
SELECT CASE WHEN f."asaasChargeId" IS NULL THEN 'sem cobrança (ainda não fechou no D-5, ou o fechamento falhou)' ELSE 'com cobrança' END AS situacao,
       COUNT(*) AS faturas, SUM(f."valorTotal") AS valor,
       MIN(f."dataVencimento")::date AS venc_min, MAX(f."dataVencimento")::date AS venc_max
FROM faturas f
WHERE f."deletedAt" IS NULL
  AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
  AND f."dataVencimento" >= :'de' AND f."dataVencimento" < :'ate'
GROUP BY 1
ORDER BY 1;
