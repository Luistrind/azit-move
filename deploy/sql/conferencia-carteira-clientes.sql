-- Conferência da Carteira — CLIENTES e MESES SEGUINTES (doc 02 §27). SÓ LEITURA.
-- Responde duas dúvidas da tela (Luís, 16/11/2026):
--   a) por que o teto do mês conta menos clientes do que os ativos (65 × 67);
--   b) por que o teto muda tanto de um mês para o outro (dezembro maior, janeiro menor).
-- Rodar no banco de PRODUÇÃO. Mês de partida padrão = novembro/2026; para outro,
-- passe -v de=AAAA-MM-01:
--   git show origin/fix/carteira-clientes-conferencia:deploy/sql/conferencia-carteira-clientes.sql \
--     | docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -f -
--
-- O que a tela calcula: TETO do mês = soma do valorTotal das faturas com
-- VENCIMENTO no mês, status ABERTA/FECHADA/PAGA/PAGA_EM_ATRASO; "clientes" =
-- contas distintas com pelo menos uma dessas faturas. Cliente ATIVO aqui =
-- conta com pelo menos um contrato em status ATIVO.
\if :{?de}
\else
\set de '2026-11-01'
\endif
\pset footer off
\echo
\echo '################ Mês de partida:' :de '################'

\echo
\echo '=== 1) Clientes ativos × clientes no teto, mês a mês (4 meses) ==='
\echo '    ativos_sem_fatura = contrato ATIVO e nenhuma fatura contável com vencimento no mês'
\echo '    no_teto_sem_ativo = tem fatura contável no mês, mas nenhum contrato ATIVO'
WITH meses AS (
  SELECT (:'de'::date + (n || ' month')::interval)::date AS ini,
         (:'de'::date + ((n + 1) || ' month')::interval)::date AS fim
  FROM generate_series(0, 3) n
), ativos AS (
  SELECT DISTINCT c."contaId" FROM contratos_credito c WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO'
), teto AS (
  SELECT m.ini, f."contaId", COUNT(*) AS faturas, SUM(f."valorTotal") AS valor
  FROM meses m
  JOIN faturas f ON f."dataVencimento" >= m.ini AND f."dataVencimento" < m.fim
  WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
  GROUP BY 1, 2
)
SELECT to_char(m.ini, 'MM/YYYY') AS mes,
       (SELECT COUNT(*) FROM ativos) AS clientes_ativos_hoje,
       COUNT(t."contaId") AS clientes_no_teto,
       COALESCE(SUM(t.faturas), 0) AS faturas,
       COALESCE(SUM(t.valor), 0) AS teto,
       (SELECT COUNT(*) FROM ativos a WHERE NOT EXISTS (SELECT 1 FROM teto x WHERE x.ini = m.ini AND x."contaId" = a."contaId")) AS ativos_sem_fatura,
       COUNT(t."contaId") FILTER (WHERE NOT EXISTS (SELECT 1 FROM ativos a WHERE a."contaId" = t."contaId")) AS no_teto_sem_ativo
FROM meses m
LEFT JOIN teto t ON t.ini = m.ini
GROUP BY m.ini
ORDER BY m.ini;

\echo
\echo '=== 2) QUEM são os ativos sem fatura contável no mês de partida — e por quê ==='
\echo '    no_mes_fora_do_teto = faturas do mês que existem mas não contam (status entre parênteses)'
SELECT t.nome,
       (SELECT STRING_AGG(c.numero || ' (' || c.periodicidade || ', assinado ' || to_char(c."dataAssinatura", 'DD/MM/YY') || ')', ' + ' ORDER BY c.numero)
          FROM contratos_credito c WHERE c."contaId" = co.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO') AS contratos_ativos,
       (SELECT MAX(f."dataVencimento")::date FROM faturas f
         WHERE f."contaId" = co.id AND f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
           AND f."dataVencimento" < :'de') AS ultima_antes,
       (SELECT MIN(f."dataVencimento")::date FROM faturas f
         WHERE f."contaId" = co.id AND f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
           AND f."dataVencimento" >= (:'de'::date + interval '1 month')) AS proxima_depois,
       (SELECT STRING_AGG('fat ' || f.numero || ' ' || to_char(f."dataVencimento", 'DD/MM') || ' (' || CASE WHEN f."deletedAt" IS NOT NULL THEN 'apagada' ELSE f.status::text END || ')', ', ' ORDER BY f."dataVencimento")
          FROM faturas f
         WHERE f."contaId" = co.id AND f."dataVencimento" >= :'de' AND f."dataVencimento" < (:'de'::date + interval '1 month')) AS no_mes_fora_do_teto
FROM contas co
JOIN titulares t ON t.id = co."titularId"
WHERE EXISTS (SELECT 1 FROM contratos_credito c WHERE c."contaId" = co.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO')
  AND NOT EXISTS (
    SELECT 1 FROM faturas f
    WHERE f."contaId" = co.id AND f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
      AND f."dataVencimento" >= :'de' AND f."dataVencimento" < (:'de'::date + interval '1 month'))
ORDER BY 1;

\echo
\echo '=== 3) QUEM está no teto do mês de partida sem contrato ATIVO ==='
SELECT t.nome, COUNT(*) AS faturas, SUM(f."valorTotal") AS valor,
       STRING_AGG(DISTINCT f.status::text, ', ') AS status_das_faturas,
       (SELECT STRING_AGG(c.numero || ' (' || c.status || COALESCE('/' || c."motivoEncerramento", '') || ')', ' + ' ORDER BY c.numero)
          FROM contratos_credito c WHERE c."contaId" = co.id AND c."deletedAt" IS NULL) AS contratos
FROM faturas f
JOIN contas co   ON co.id = f."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
  AND f."dataVencimento" >= :'de' AND f."dataVencimento" < (:'de'::date + interval '1 month')
  AND NOT EXISTS (SELECT 1 FROM contratos_credito c WHERE c."contaId" = co.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO')
GROUP BY t.nome, co.id
ORDER BY 1;

\echo
\echo '=== 4) Do que o teto é feito, mês a mês (itens das faturas contáveis) ==='
\echo '    queda em INTERMEDIARIA = entradas diluídas que acabam; queda em PRINCIPAL = menos parcelas no mês'
WITH meses AS (
  SELECT (:'de'::date + (n || ' month')::interval)::date AS ini,
         (:'de'::date + ((n + 1) || ' month')::interval)::date AS fim
  FROM generate_series(0, 3) n
)
SELECT to_char(m.ini, 'MM/YYYY') AS mes, i.tipo, COUNT(*) AS itens, COUNT(DISTINCT f."contaId") AS contas, SUM(i.valor) AS valor
FROM meses m
JOIN faturas f      ON f."dataVencimento" >= m.ini AND f."dataVencimento" < m.fim
JOIN itens_fatura i ON i."faturaId" = f.id
WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
GROUP BY m.ini, i.tipo
ORDER BY m.ini, i.tipo;

\echo
\echo '=== 5) Faturas por dia da semana do vencimento, mês a mês ==='
\echo '    mês com 5 ocorrências do dia tem uma fatura a mais por cliente semanal daquele dia (variação normal do calendário)'
WITH meses AS (
  SELECT (:'de'::date + (n || ' month')::interval)::date AS ini,
         (:'de'::date + ((n + 1) || ' month')::interval)::date AS fim
  FROM generate_series(0, 3) n
)
SELECT to_char(m.ini, 'MM/YYYY') AS mes,
       COUNT(*) FILTER (WHERE EXTRACT(DOW FROM f."dataVencimento") = 1) AS seg,
       COUNT(*) FILTER (WHERE EXTRACT(DOW FROM f."dataVencimento") = 2) AS ter,
       COUNT(*) FILTER (WHERE EXTRACT(DOW FROM f."dataVencimento") = 3) AS qua,
       COUNT(*) FILTER (WHERE EXTRACT(DOW FROM f."dataVencimento") = 4) AS qui,
       COUNT(*) FILTER (WHERE EXTRACT(DOW FROM f."dataVencimento") = 5) AS sex,
       COUNT(*) FILTER (WHERE EXTRACT(DOW FROM f."dataVencimento") = 6) AS sab,
       COUNT(*) FILTER (WHERE EXTRACT(DOW FROM f."dataVencimento") = 0) AS dom,
       COUNT(*) AS total
FROM meses m
JOIN faturas f ON f."dataVencimento" >= m.ini AND f."dataVencimento" < m.fim
WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
GROUP BY m.ini
ORDER BY m.ini;

\echo
\echo '=== 6) Cliente a cliente: quem cai do 2º para o 3º mês (dezembro → janeiro no padrão) ==='
\echo '    f = nº de faturas, v = valor; ultima_fatura = último vencimento contável da conta (se for cedo, o cronograma acaba aí)'
WITH base AS (
  SELECT f."contaId", date_trunc('month', f."dataVencimento")::date AS mes, COUNT(*) AS n, SUM(f."valorTotal") AS v
  FROM faturas f
  WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
    AND f."dataVencimento" >= :'de' AND f."dataVencimento" < (:'de'::date + interval '4 month')
  GROUP BY 1, 2
), piv AS (
  SELECT "contaId",
         COALESCE(MAX(n) FILTER (WHERE mes = :'de'::date), 0)                               AS f1,
         COALESCE(MAX(v) FILTER (WHERE mes = :'de'::date), 0)                               AS v1,
         COALESCE(MAX(n) FILTER (WHERE mes = (:'de'::date + interval '1 month')::date), 0)  AS f2,
         COALESCE(MAX(v) FILTER (WHERE mes = (:'de'::date + interval '1 month')::date), 0)  AS v2,
         COALESCE(MAX(n) FILTER (WHERE mes = (:'de'::date + interval '2 month')::date), 0)  AS f3,
         COALESCE(MAX(v) FILTER (WHERE mes = (:'de'::date + interval '2 month')::date), 0)  AS v3,
         COALESCE(MAX(n) FILTER (WHERE mes = (:'de'::date + interval '3 month')::date), 0)  AS f4,
         COALESCE(MAX(v) FILTER (WHERE mes = (:'de'::date + interval '3 month')::date), 0)  AS v4
  FROM base GROUP BY 1
)
SELECT t.nome, p.f1, p.v1, p.f2, p.v2, p.f3, p.v3, p.f4, p.v4,
       (p.v3 - p.v2) AS diferenca_3o_menos_2o,
       (SELECT MAX(f."dataVencimento")::date FROM faturas f
         WHERE f."contaId" = p."contaId" AND f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')) AS ultima_fatura,
       (SELECT STRING_AGG(c.numero || ' (' || c.status || '/' || c.periodicidade || ')', ' + ' ORDER BY c.numero)
          FROM contratos_credito c WHERE c."contaId" = p."contaId" AND c."deletedAt" IS NULL) AS contratos
FROM piv p
JOIN contas co   ON co.id = p."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE p.v3 < p.v2
ORDER BY (p.v3 - p.v2), t.nome;

\echo
\echo '=== 7) Resumo da diferença do 2º para o 3º mês ==='
WITH base AS (
  SELECT f."contaId", date_trunc('month', f."dataVencimento")::date AS mes, COUNT(*) AS n, SUM(f."valorTotal") AS v
  FROM faturas f
  WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA','PAGA','PAGA_EM_ATRASO')
    AND f."dataVencimento" >= (:'de'::date + interval '1 month') AND f."dataVencimento" < (:'de'::date + interval '3 month')
  GROUP BY 1, 2
), piv AS (
  SELECT "contaId",
         COALESCE(MAX(n) FILTER (WHERE mes = (:'de'::date + interval '1 month')::date), 0) AS f2,
         COALESCE(MAX(v) FILTER (WHERE mes = (:'de'::date + interval '1 month')::date), 0) AS v2,
         COALESCE(MAX(n) FILTER (WHERE mes = (:'de'::date + interval '2 month')::date), 0) AS f3,
         COALESCE(MAX(v) FILTER (WHERE mes = (:'de'::date + interval '2 month')::date), 0) AS v3
  FROM base GROUP BY 1
)
SELECT CASE
         WHEN f3 = 0 THEN '1 some do 3º mês (nenhuma fatura)'
         WHEN f3 < f2 THEN '2 menos faturas no 3º mês'
         WHEN v3 < v2 THEN '3 mesmo nº de faturas, valor menor'
         WHEN v3 > v2 THEN '5 sobe'
         ELSE '4 igual'
       END AS o_que_acontece,
       COUNT(*) AS clientes, SUM(f2) AS faturas_2o, SUM(v2) AS valor_2o, SUM(f3) AS faturas_3o, SUM(v3) AS valor_3o, SUM(v3 - v2) AS diferenca
FROM piv
GROUP BY 1
ORDER BY 1;
