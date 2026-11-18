-- Reembolsos Parcelados aprovados e ainda não ativos (doc 02 §18.7, 18/11/2026).
-- SÓ LEITURA. Mostra os que estão parados em "aguardando assinatura" (recebem o
-- "de acordo" pela página do contrato) e os que a expiração de assinatura já
-- cancelou nos últimos 90 dias (precisam ser refeitos pela contratação nova).
--
--   git show origin/<branch>:deploy/sql/reembolsos-aguardando-assinatura.sql | \
--     docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -f -

\echo '== 1. Reembolsos aprovados, aguardando assinatura =='
SELECT k.numero                                   AS contrato,
       t.nome                                     AS cliente,
       k."valorTotal"                             AS total_cliente,
       (a.payload->>'valorPrincipal')::numeric / 100 AS pago_ao_fornecedor,
       a.payload->>'fornecedorNome'               AS fornecedor,
       to_char(k."dataAprovacao" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS aprovado_em,
       COALESCE(d.status::text, 'sem documento')  AS termo_zapsign,
       (now()::date - COALESCE(d."enviadoEm", k."createdAt")::date) AS dias_parado
  FROM contratos_credito k
  JOIN aprovacoes a ON a."referenciaTipo" = 'contrato_credito' AND a."referenciaId" = k.id AND a."tipoOperacao" = 'reembolso_parcelado'
  JOIN contas c ON c.id = k."contaId"
  JOIN titulares t ON t.id = c."titularId"
  LEFT JOIN documentos_assinatura d ON d."contratoCreditoId" = k.id
 WHERE k."deletedAt" IS NULL AND k.status = 'AGUARDANDO_ASSINATURA'
 ORDER BY k."dataAprovacao";

\echo '== 2. Reembolsos aprovados e depois cancelados (últimos 90 dias) =='
SELECT k.numero                                   AS contrato,
       t.nome                                     AS cliente,
       (a.payload->>'valorPrincipal')::numeric / 100 AS pago_ao_fornecedor,
       a.payload->>'fornecedorNome'               AS fornecedor,
       to_char(k."dataAprovacao" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS aprovado_em,
       to_char(k."dataEncerramento" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS cancelado_em,
       k."motivoEncerramento"                     AS motivo
  FROM contratos_credito k
  JOIN aprovacoes a ON a."referenciaTipo" = 'contrato_credito' AND a."referenciaId" = k.id AND a."tipoOperacao" = 'reembolso_parcelado' AND a.status = 'APROVADA'
  JOIN contas c ON c.id = k."contaId"
  JOIN titulares t ON t.id = c."titularId"
 WHERE k."deletedAt" IS NULL AND k.status = 'ENCERRADO' AND k."cronogramaGeradoEm" IS NULL
   AND k."dataEncerramento" > now() - interval '90 days'
 ORDER BY k."dataEncerramento" DESC;
