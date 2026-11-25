-- SÓ LEITURA. Valor para quitar HOJE os contratos ativos de um cliente, pela mesma
-- conta do sistema (QuitacaoService.simular, v1.12.0, doc 02 §7.4), parcela a parcela.
-- Mostra também o valor CORRIGIDO (parcela de acordo sem abatimento de comissão e
-- proteção) e os alertas que impedem ou atrapalham a quitação.
--
-- Rodar no servidor (troque o nome; % vale qualquer coisa no meio):
--   cd /opt/azit && git fetch origin && git show origin/fix/conferencia-quitacao:deploy/sql/valor-quitacao-cliente.sql \
--     | docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -v nome='%marcos%ribeiro%' -f -

\if :{?nome}
\else
  \set nome '%marcos%ribeiro%'
\endif
\pset footer off

CREATE TEMP TABLE qc AS
SELECT c.id, c.numero, t.nome AS cliente, c.periodicidade::text AS per,
       COALESCE(c."taxaDescontoQuitacao", 0)::numeric AS taxa_unica,
       CASE WHEN c."catalogoVersaoRef" LIKE '{%' THEN c."catalogoVersaoRef"::jsonb ELSE '{}'::jsonb END AS ref,
       (SELECT s."parametroVersaoId" FROM propostas p JOIN simulacoes s ON s.id = p."simulacaoId"
         WHERE (p."contratoGeradoId" = c.id OR p.id = c."propostaPacoteId") AND s."parametroVersaoId" IS NOT NULL
         LIMIT 1) AS versao_id
  FROM contratos_credito c
  JOIN contas co ON co.id = c."contaId"
  JOIN titulares t ON t.id = co."titularId"
 WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO' AND t.nome ILIKE :'nome';

-- Parâmetros de cada contrato, pelo caminho que o sistema usa.
CREATE TEMP TABLE qp AS
WITH base AS (
  SELECT qc.*,
         CASE WHEN ref ? 'variante' THEN 'catalogo' WHEN ref ? 'nv' THEN 'novacao'
              WHEN versao_id IS NOT NULL THEN 'parametros' ELSE 'taxa_unica' END AS caminho,
         CASE per WHEN 'MENSAL' THEN 1 WHEN 'QUINZENAL' THEN 2 ELSE 4 END AS fv,      -- divisor do valor mensal
         CASE per WHEN 'MENSAL' THEN 4 WHEN 'QUINZENAL' THEN 2 ELSE 1 END AS fsem     -- multiplicador do valor semanal
    FROM qc
), cat AS (
  SELECT b.id,
         COALESCE(vp.parametros::jsonb, '{}'::jsonb) || COALESCE(vv.parametros::jsonb, '{}'::jsonb) AS prm
    FROM base b
    JOIN produtos_catalogo pc ON pc.chave = 'compra_parcelada' AND pc."deletedAt" IS NULL
    LEFT JOIN variantes_produto va ON va."produtoId" = pc.id AND va.chave = b.ref->>'variante'
    LEFT JOIN versoes_produto vp ON vp."produtoId" = pc.id AND vp."varianteId" IS NULL AND vp.numero = (b.ref->>'vp')::int
    LEFT JOIN versoes_produto vv ON vv."produtoId" = pc.id AND vv."varianteId" = va.id AND vv.numero = (b.ref->>'vv')::int
   WHERE b.caminho = 'catalogo'
), pv AS (
  SELECT (v.parametros::jsonb->>'taxaDescontoProtecaoAntecipacao')::numeric AS taxa
    FROM produtos_catalogo p JOIN versoes_produto v ON v."produtoId" = p.id AND v."varianteId" IS NULL AND v."vigenteAte" IS NULL
   WHERE p.chave = 'protecao_veicular' AND p."deletedAt" IS NULL
   ORDER BY v.numero DESC LIMIT 1
)
SELECT b.id, b.numero, b.cliente, b.per, b.caminho,
       -- caminho catálogo (por componente)
       (cat.prm->>'taxaDescontoBemAntecipacao')::numeric AS t_bem,
       (cat.prm->>'taxaDescontoComissaoAntecipacao')::numeric AS t_com,
       COALESCE((SELECT taxa FROM pv), (cat.prm->>'taxaDescontoProtecaoAntecipacao')::numeric, 0) AS t_prot,
       (cat.prm->>'isencaoComissaoLiquidacao') = 'true' AS isen_com,
       (cat.prm->>'isencaoProtecaoLiquidacao') = 'true' AS isen_prot,
       round(COALESCE((cat.prm->>'comissaoRecorrenteMensal')::numeric, 0) / b.fv) AS com_p,
       round(b.fsem * CASE
         WHEN b.ref ? 'protS' THEN round((b.ref->>'protS')::numeric)
         WHEN (cat.prm->>'protecaoObrigatoria') = 'true' THEN round(COALESCE((cat.prm->>'protecaoMensal')::numeric, 0) / 4)
         ELSE 0 END) AS prot_p,
       -- demais caminhos (CR × resto)
       CASE b.caminho WHEN 'novacao' THEN COALESCE((b.ref->>'dcr')::numeric, 0.2)
                      WHEN 'parametros' THEN v."taxaDescontoAntecipacaoCR" ELSE 0 END AS t_cr,
       CASE b.caminho WHEN 'novacao' THEN COALESCE((b.ref->>'taxaM')::numeric, b.taxa_unica)
                      WHEN 'parametros' THEN v."taxaMensal" ELSE b.taxa_unica END AS t_ps,
       CASE b.caminho WHEN 'novacao' THEN greatest(0, round(COALESCE((b.ref->>'crP')::numeric, 0)))
                      WHEN 'parametros' THEN round(v."comissaoRecorrente" * 100 / NULLIF(CASE b.per WHEN 'SEMANAL' THEN v."fatorPrecificacaoSemanal"
                                                                             WHEN 'QUINZENAL' THEN v."fatorPrecificacaoQuinzenal" ELSE 1 END, 0))
                      ELSE 0 END AS cr_p
  FROM base b
  LEFT JOIN cat ON cat.id = b.id
  LEFT JOIN versoes_parametros_simulacao v ON v.id = b.versao_id;

-- Parcela a parcela (centavos). vp(v, t, d) = v / (1+t)^(d/30) = v / (1+diária)^d.
CREATE TEMP TABLE qx AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
par AS (
  SELECT qp.*, p.id AS parcela_id, p.display, p."faturaId",
         round(p."valorNominal" * 100) AS vf,
         greatest(0, p."dataVencimento"::date - (SELECT d FROM hoje)) AS dias,
         (i.origem = 'ACORDO') AS de_acordo
    FROM qp
    JOIN parcelas p ON p."contratoId" = qp.id AND p.status IS NULL AND p."acordoId" IS NULL AND p."deletedAt" IS NULL
    JOIN itens_contratados i ON i.id = p."itemContratadoId"
)
SELECT par.*,
  CASE WHEN caminho = 'catalogo' THEN
         round(CASE WHEN dias <= 0 OR COALESCE(t_bem, 0) <= 0 THEN greatest(0, vf - com_p - prot_p)
                    ELSE greatest(0, vf - com_p - prot_p) / power(1 + t_bem, dias / 30.0) END)
       + CASE WHEN isen_com AND dias > 0 OR com_p <= 0 THEN 0
              ELSE round(CASE WHEN dias <= 0 OR COALESCE(t_com, 0) <= 0 THEN com_p ELSE com_p / power(1 + t_com, dias / 30.0) END) END
       + CASE WHEN isen_prot AND dias > 0 OR prot_p <= 0 THEN 0
              ELSE round(CASE WHEN dias <= 0 OR COALESCE(t_prot, 0) <= 0 THEN prot_p ELSE prot_p / power(1 + t_prot, dias / 30.0) END) END
  ELSE
    round( (CASE WHEN dias <= 0 OR COALESCE(t_cr, 0) <= 0 THEN least(cr_p, vf) ELSE least(cr_p, vf) / power(1 + t_cr, dias / 30.0) END)
         + (CASE WHEN dias <= 0 OR COALESCE(t_ps, 0) <= 0 THEN vf - least(cr_p, vf) ELSE (vf - least(cr_p, vf)) / power(1 + t_ps, dias / 30.0) END) )
  END AS vp_sistema,
  -- Correção proposta: parcela de acordo é dívida pura — só o desconto pelo tempo, na taxa do contrato.
  CASE WHEN de_acordo AND caminho IN ('catalogo', 'parametros') THEN
         round(CASE WHEN dias <= 0 OR COALESCE(CASE WHEN caminho = 'catalogo' THEN t_bem ELSE t_ps END, 0) <= 0 THEN vf
                    ELSE vf / power(1 + CASE WHEN caminho = 'catalogo' THEN t_bem ELSE t_ps END, dias / 30.0) END)
  END AS vp_acordo_corrigido
  FROM par;

\echo ''
\echo '== Contratos ativos encontrados e como o sistema calcula =='
SELECT cliente, numero AS contrato, per AS frequencia, caminho,
       CASE caminho WHEN 'catalogo' THEN 'bem ' || round(t_bem * 100, 2) || '% a.m.; comissão ' || round(com_p / 100.0, 2)
                                           || (CASE WHEN isen_com THEN ' (isenta)' ELSE '' END) || '; proteção ' || round(prot_p / 100.0, 2)
                                           || (CASE WHEN isen_prot THEN ' (isenta)' ELSE '' END)
                    ELSE 'taxa ' || round(COALESCE(t_ps, 0) * 100, 2) || '% a.m.' || CASE WHEN cr_p > 0 THEN '; comissão ' || round(cr_p / 100.0, 2) || ' a ' || round(t_cr * 100, 0) || '% a.m.' ELSE '' END
       END AS regra
  FROM qp ORDER BY numero;

\echo ''
\echo '== VALOR PARA QUITAR HOJE (R$) =='
SELECT cliente, numero AS contrato, count(*) AS parcelas_em_aberto,
       count(*) FILTER (WHERE dias = 0) AS vencidas_ou_hoje,
       round(sum(vf) / 100.0, 2) AS valor_cheio,
       round(sum(vp_sistema) / 100.0, 2) AS sistema_mostra,
       round(sum(COALESCE(vp_acordo_corrigido, vp_sistema)) / 100.0, 2) AS valor_corrigido,
       round((sum(vf) - sum(COALESCE(vp_acordo_corrigido, vp_sistema))) / 100.0, 2) AS desconto
  FROM qx GROUP BY cliente, numero ORDER BY numero;

\echo ''
\echo '== Parcelas (as 12 primeiras de cada contrato; vencida ou de hoje entra cheia, sem multa e mora) =='
SELECT numero AS contrato, display AS parcela, dias, de_acordo,
       round(vf / 100.0, 2) AS cheio, round(vp_sistema / 100.0, 2) AS hoje,
       round(vp_acordo_corrigido / 100.0, 2) AS acordo_corrigido
  FROM (SELECT qx.*, row_number() OVER (PARTITION BY id ORDER BY dias, display) AS rn FROM qx) z
 WHERE rn <= 12 ORDER BY numero, dias, display;

\echo ''
\echo '== ALERTAS =='
SELECT 'Fatura #' || f.numero || ' (Pix sob demanda, já disponível): o sistema RECUSA a quitação até ela ser paga pela página' AS alerta
  FROM faturas f WHERE f.id IN (SELECT "faturaId" FROM qx) AND f."modeloEncargo" = 'AZIT' AND f.status = 'FECHADA'
UNION ALL
SELECT 'Fatura #' || f.numero || ' vence ' || to_char(f."dataVencimento", 'DD/MM/YYYY') || ' e tem cobrança no Asaas (' || f."asaasChargeId" || '): a quitação NÃO cancela — cancelar à mão'
  FROM faturas f WHERE f.id IN (SELECT "faturaId" FROM qx) AND f.status IN ('ABERTA', 'FECHADA') AND f."asaasChargeId" IS NOT NULL
UNION ALL
SELECT 'Fatura #' || f.numero || ' tem parcela de outro contrato (' || c.numero || '): a quitação marcaria a fatura inteira como paga'
  FROM faturas f
  JOIN parcelas p ON p."faturaId" = f.id AND p.status IS NULL AND p."deletedAt" IS NULL AND p."contratoId" NOT IN (SELECT id FROM qc)
  JOIN contratos_credito c ON c.id = p."contratoId"
 WHERE f.id IN (SELECT "faturaId" FROM qx)
UNION ALL
SELECT 'Contrato ' || numero || ': ' || count(*) || ' parcela(s) de acordo descontadas como parcela do carro — use o valor corrigido'
  FROM qx WHERE de_acordo AND caminho IN ('catalogo', 'parametros') GROUP BY numero
UNION ALL
SELECT 'Contrato ' || numero || ': sem taxa gravada — a quitação sai sem desconto'
  FROM qp WHERE caminho = 'taxa_unica' AND COALESCE(t_ps, 0) = 0;
