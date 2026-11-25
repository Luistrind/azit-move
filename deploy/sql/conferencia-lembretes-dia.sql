-- SÓ LEITURA. Por que cada cliente recebeu (ou não) o lembrete de pagamento pelo
-- WhatsApp — faturas que vencem HOJE (D0) e daqui a 2 dias (D-2), com o motivo,
-- na mesma ordem de regras do LembreteService (v1.12.0, doc 02 §28).
--
-- Rodar no servidor:
--   cd /opt/azit && git fetch origin && git show origin/fix/conferencia-quitacao:deploy/sql/conferencia-lembretes-dia.sql \
--     | docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -f -
-- Outro dia: acrescente  -v dia=2026-11-24  antes do -f.

\if :{?dia}
\else
  SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia \gset
\endif
\pset footer off

\echo ''
\echo '== Envios automáticos (chave geral) =='
SELECT CASE WHEN ativo THEN 'LIGADOS' ELSE 'DESLIGADOS — nenhum lembrete sai' END AS envios_automaticos
  FROM parametros_whatsapp ORDER BY versao DESC LIMIT 1;

\echo ''
\echo '== Faturas que vencem no dia e 2 dias depois, e o que aconteceu com o lembrete =='
SELECT t.nome AS cliente,
       f.numero AS fatura,
       to_char(f."dataVencimento", 'DD/MM') AS vence,
       CASE f."dataVencimento"::date - :'dia'::date WHEN 0 THEN 'D0' ELSE 'D-2' END AS momento,
       f.status::text AS status_fatura,
       f."valorTotal" - COALESCE(f."valorPago", 0) AS saldo,
       COALESCE(l.situacao::text, '—') AS lembrete,
       COALESCE(to_char(l."enviadoEm" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), '') AS enviado,
       COALESCE(to_char(l."entregueEm" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), '') AS entregue,
       CASE
         WHEN l.id IS NOT NULL AND l.situacao::text IN ('ENVIADO', 'ENTREGUE', 'LIDO') THEN 'saiu'
         WHEN l.id IS NOT NULL THEN 'tentou: ' || COALESCE(l.motivo, l.situacao::text)
         WHEN NOT COALESCE(lt.ativo, false) THEN 'NÃO SAI: lembrete DESLIGADO na ficha do titular'
         WHEN f.status::text <> 'FECHADA' THEN 'NÃO SAI: fatura ' || f.status::text || ' (só sai fatura fechada em aberto)'
         WHEN f."valorTotal" - COALESCE(f."valorPago", 0) <= 0 THEN 'NÃO SAI: sem saldo em aberto'
         WHEN f."acordoId" IS NOT NULL
              OR (EXISTS (SELECT 1 FROM parcelas p WHERE p."faturaId" = f.id)
                  AND NOT EXISTS (SELECT 1 FROM parcelas p WHERE p."faturaId" = f.id AND p."acordoId" IS NULL))
              THEN 'NÃO SAI: fatura coberta por acordo'
         WHEN f."tokenPublico" IS NULL THEN 'NÃO SAI: fatura sem link público'
         ELSE 'deveria ter saído — ainda não rodou (rodadas de hora em hora, 9h às 19h)'
       END AS motivo,
       t.whatsapp
  FROM faturas f
  JOIN contas co ON co.id = f."contaId"
  JOIN titulares t ON t.id = co."titularId"
  LEFT JOIN lembretes_titular lt ON lt."titularId" = t.id
  LEFT JOIN lembretes_pagamento l ON l."faturaId" = f.id
        AND l.momento::text = CASE f."dataVencimento"::date - :'dia'::date WHEN 0 THEN 'D_ZERO' ELSE 'D_MENOS_2' END
 WHERE f."deletedAt" IS NULL
   AND f."dataVencimento"::date IN (:'dia'::date, :'dia'::date + 2)
 ORDER BY f."dataVencimento", motivo, t.nome;

\echo ''
\echo '== Titulares com contrato ativo e lembrete DESLIGADO (não recebem nada pelo WhatsApp) =='
SELECT t.nome AS cliente, t.whatsapp, CASE WHEN lt."titularId" IS NULL THEN 'nunca ligado' ELSE 'desligado' END AS lembrete
  FROM titulares t
  JOIN contas co ON co."titularId" = t.id
  LEFT JOIN lembretes_titular lt ON lt."titularId" = t.id
 WHERE NOT COALESCE(lt.ativo, false)
   AND EXISTS (SELECT 1 FROM contratos_credito c WHERE c."contaId" = co.id AND c.status = 'ATIVO' AND c."deletedAt" IS NULL)
 ORDER BY t.nome;
