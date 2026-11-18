-- ALTERA DADOS. Rodar só por deploy/acerto-cobranca-compartilhada-2026-11.sh
-- (explicação lá). Tudo numa transação; mostra ANTES e DEPOIS.
BEGIN;

-- Os pares a acertar: intermediária em aberto × fatura paga da mesma conta e da mesma cobrança.
CREATE TEMP TABLE acerto_pares ON COMMIT DROP AS
SELECT i.id AS inter_id, p.id AS paga_id, t.nome AS cliente,
       i.numero AS inter_numero, p.numero AS paga_numero,
       i."valorTotal" AS valor_inter, i."dataVencimento" AS venc_inter, i.status::text AS inter_status_antes,
       p."valorTotal" AS paga_total, p."valorPago" AS paga_pago_antes, p."dataPagamento" AS pago_em,
       i."asaasChargeId" AS cobranca
  FROM faturas i
  JOIN faturas p ON p."contaId" = i."contaId" AND p."asaasChargeId" = i."asaasChargeId" AND p.id <> i.id
  JOIN contas c ON c.id = i."contaId"
  JOIN titulares t ON t.id = c."titularId"
 WHERE i."deletedAt" IS NULL AND p."deletedAt" IS NULL
   AND i."asaasChargeId" IS NOT NULL
   AND i.status IN ('ABERTA', 'FECHADA') AND COALESCE(i."valorPago", 0) = 0
   AND p.status IN ('PAGA', 'PAGA_EM_ATRASO') AND p."dataPagamento" IS NOT NULL
   AND p."valorPago" >= p."valorTotal" + i."valorTotal"
   AND EXISTS (SELECT 1 FROM itens_fatura x WHERE x."faturaId" = i.id)
   AND NOT EXISTS (SELECT 1 FROM itens_fatura x WHERE x."faturaId" = i.id AND x.tipo <> 'INTERMEDIARIA');

\echo '== ANTES =='
SELECT cliente, cobranca,
       'nº ' || paga_numero || ': pago ' || paga_pago_antes || ' de ' || paga_total AS fatura_paga,
       'nº ' || inter_numero || ': ' || inter_status_antes || ', ' || valor_inter || ' em aberto' AS intermediaria
  FROM acerto_pares ORDER BY cliente, inter_numero;

INSERT INTO logs_auditoria (id, acao, entidade, "entidadeId", antes, depois, "createdAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || inter_id), 1, 24),
       'acerto_cobranca_compartilhada', 'fatura', inter_id,
       jsonb_build_object('intermediaria', jsonb_build_object('numero', inter_numero, 'status', inter_status_antes, 'valorPago', NULL),
                          'faturaPaga', jsonb_build_object('numero', paga_numero, 'valorPago', paga_pago_antes), 'cobranca', cobranca),
       jsonb_build_object('intermediaria', jsonb_build_object('numero', inter_numero, 'valorPago', valor_inter, 'dataPagamento', pago_em),
                          'faturaPaga', jsonb_build_object('numero', paga_numero, 'valorPago', paga_pago_antes - valor_inter),
                          'motivo', 'Cobrança única do legado cobria a parcela e a intermediária; o pagamento baixou só a fatura da parcela (acerto 18/11/2026)'),
       now()
  FROM acerto_pares;

-- Intermediária baixada pelo valor dela, na data do pagamento. Em atraso quando o
-- dia do pagamento (no fuso do Brasil) é depois do vencimento.
UPDATE faturas f
   SET status = (CASE WHEN (a.pago_em AT TIME ZONE 'America/Sao_Paulo')::date > a.venc_inter::date THEN 'PAGA_EM_ATRASO' ELSE 'PAGA' END)::"StatusFatura",
       "valorPago" = a.valor_inter, "dataPagamento" = a.pago_em, "updatedAt" = now()
  FROM acerto_pares a
 WHERE f.id = a.inter_id;

-- A fatura da parcela fica com o que é dela (valor + multa e atualização).
UPDATE faturas f
   SET "valorPago" = f."valorPago" - a.valor_inter, "updatedAt" = now()
  FROM acerto_pares a
 WHERE f.id = a.paga_id;

\echo '== DEPOIS =='
SELECT a.cliente,
       'nº ' || p.numero || ': pago ' || p."valorPago" || ' de ' || p."valorTotal" AS fatura_paga,
       'nº ' || i.numero || ': ' || i.status || ', pago ' || i."valorPago" || ' em ' || to_char(i."dataPagamento" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS intermediaria,
       (a.paga_pago_antes = p."valorPago" + i."valorPago") AS soma_confere
  FROM acerto_pares a
  JOIN faturas p ON p.id = a.paga_id
  JOIN faturas i ON i.id = a.inter_id
 ORDER BY a.cliente, i.numero;

COMMIT;
