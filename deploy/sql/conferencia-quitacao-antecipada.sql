-- SÓ LEITURA. Conferência da quitação antecipada em produção (25/11/2026).
-- Não altera nada: só SELECT.
--
-- Rodar no servidor:
--   cd /opt/azit && git fetch origin && git show origin/fix/conferencia-quitacao:deploy/sql/conferencia-quitacao-antecipada.sql \
--     | docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -f -
--
-- Caminhos de cálculo (QuitacaoService.carregar):
--   catalogo   = contrato nascido do Catálogo (ref com "variante"): bem na TRD, comissão e proteção à parte,
--                comissão e proteção ISENTAS na liquidação total
--   novacao    = contrato de novação (ref com "nv"): comissão a 20% a.m., resto na taxa da novação
--   parametros = contrato nativo anterior ao Catálogo (versão de parâmetros da simulação)
--   taxa_unica = migrado / sem versão: taxa única taxaDescontoQuitacao do contrato, sem separar comissão

\pset footer off

CREATE TEMP TABLE q_contratos AS
SELECT c.id, c.numero, t.nome AS cliente, c.status::text AS status, c.periodicidade::text AS periodicidade,
       c."taxaDescontoQuitacao" AS taxa_unica,
       CASE
         WHEN c."catalogoVersaoRef" LIKE '%"variante"%' THEN 'catalogo'
         WHEN c."catalogoVersaoRef" LIKE '%"nv"%' THEN 'novacao'
         WHEN EXISTS (SELECT 1 FROM propostas p JOIN simulacoes s ON s.id = p."simulacaoId"
                       WHERE (p."contratoGeradoId" = c.id OR p.id = c."propostaPacoteId") AND s."parametroVersaoId" IS NOT NULL)
              THEN 'parametros'
         ELSE 'taxa_unica'
       END AS caminho
  FROM contratos_credito c
  JOIN contas co ON co.id = c."contaId"
  JOIN titulares t ON t.id = co."titularId"
 WHERE c."deletedAt" IS NULL;

\echo ''
\echo '== 1. Quitações antecipadas JÁ FEITAS em produção (valores em R$) =='
SELECT to_char((l."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS quando,
       q.cliente, q.numero AS contrato, q.caminho,
       (l.depois->>'quitadas')::int AS parcelas,
       round((l.depois->>'valorNominalTotal')::numeric / 100, 2) AS nominal,
       round((l.depois->>'valorQuitacao')::numeric / 100, 2) AS cobrado,
       round(100 - 100 * (l.depois->>'valorQuitacao')::numeric / NULLIF((l.depois->>'valorNominalTotal')::numeric, 0), 1) AS desconto_pct
  FROM logs_auditoria l
  LEFT JOIN q_contratos q ON q.id = l."entidadeId"
 WHERE l.acao = 'quitacao_antecipada'
 ORDER BY l."createdAt";

\echo ''
\echo '== 2. Contratos ATIVOS por caminho de cálculo =='
SELECT caminho, count(*) AS contratos FROM q_contratos WHERE status = 'ATIVO' GROUP BY caminho ORDER BY 2 DESC;

\echo ''
\echo '== 3. Taxa única vazia ou zero: a quitação sai SEM desconto nenhum =='
SELECT cliente, numero AS contrato, taxa_unica
  FROM q_contratos
 WHERE status = 'ATIVO' AND caminho = 'taxa_unica' AND COALESCE(taxa_unica, 0) = 0
 ORDER BY cliente;

\echo ''
\echo '== 4. Parcelas de ACORDO em aberto em contrato do caminho catalogo/parametros =='
\echo '   (a quitação tira comissão e proteção de cada uma como se fosse parcela do carro)'
SELECT q.cliente, q.numero AS contrato, q.caminho, count(*) AS parcelas_acordo_abertas,
       sum(p."valorNominal") AS nominal_acordo
  FROM parcelas p
  JOIN itens_contratados i ON i.id = p."itemContratadoId" AND i.origem = 'ACORDO'
  JOIN q_contratos q ON q.id = p."contratoId"
 WHERE p."deletedAt" IS NULL AND p.status IS NULL AND p."acordoId" IS NULL
   AND q.status = 'ATIVO' AND q.caminho IN ('catalogo', 'parametros')
 GROUP BY q.cliente, q.numero, q.caminho
 ORDER BY q.cliente;

\echo ''
\echo '== 5. Faturas em aberto com parcela de MAIS DE UM contrato =='
\echo '   (quitar um dos contratos marca a fatura inteira como paga, e a parcela do outro fica sem cobrança)'
SELECT t.nome AS cliente, f.numero AS fatura, to_char(f."dataVencimento", 'DD/MM/YYYY') AS vencimento,
       f.status::text AS status, f."valorTotal" AS valor_fatura,
       string_agg(DISTINCT c.numero, ' + ') AS contratos
  FROM faturas f
  JOIN contas co ON co.id = f."contaId"
  JOIN titulares t ON t.id = co."titularId"
  JOIN parcelas p ON p."faturaId" = f.id AND p."deletedAt" IS NULL AND p.status IS NULL
  JOIN contratos_credito c ON c.id = p."contratoId" AND c.status = 'ATIVO'
 WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA', 'FECHADA')
 GROUP BY t.nome, f.id, f.numero, f."dataVencimento", f.status, f."valorTotal"
HAVING count(DISTINCT p."contratoId") > 1
 ORDER BY t.nome, f."dataVencimento"
 LIMIT 60;

\echo ''
\echo '== 5b. Total de clientes nessa situação =='
SELECT count(DISTINCT f."contaId") AS clientes, count(DISTINCT f.id) AS faturas
  FROM faturas f
  JOIN parcelas p ON p."faturaId" = f.id AND p."deletedAt" IS NULL AND p.status IS NULL
  JOIN contratos_credito c ON c.id = p."contratoId" AND c.status = 'ATIVO'
 WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA', 'FECHADA')
   AND (SELECT count(DISTINCT p2."contratoId") FROM parcelas p2 WHERE p2."faturaId" = f.id AND p2."deletedAt" IS NULL AND p2.status IS NULL) > 1;

\echo ''
\echo '== 6. Faturas em aberto que JÁ TÊM cobrança emitida no Asaas =='
\echo '   (a quitação marca a fatura como paga, mas não cancela essa cobrança: o cliente continua podendo pagá-la)'
SELECT t.nome AS cliente, f.numero AS fatura, to_char(f."dataVencimento", 'DD/MM/YYYY') AS vencimento,
       f.status::text AS status, f."modeloEncargo"::text AS modelo, f."valorTotal" AS valor
  FROM faturas f
  JOIN contas co ON co.id = f."contaId"
  JOIN titulares t ON t.id = co."titularId"
 WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA', 'FECHADA') AND f."asaasChargeId" IS NOT NULL
   AND EXISTS (SELECT 1 FROM parcelas p JOIN contratos_credito c ON c.id = p."contratoId" AND c.status = 'ATIVO'
                WHERE p."faturaId" = f.id AND p.status IS NULL AND p."deletedAt" IS NULL)
 ORDER BY f."dataVencimento"
 LIMIT 40;
