-- Intermediária (entrada diluída) que ficou "vencida" no sistema, mas foi paga
-- JUNTO com outra parcela, na mesma cobrança (caso Vinicius Andre, 18/11/2026).
-- SÓ LEITURA. Parte 1–3: o titular informado. Parte 4: a base inteira.
--
--   git show origin/<branch>:deploy/sql/conferencia-intermediaria-paga-junto.sql | \
--     docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit \
--     -v titular=cmvwyl1n0042m14kius4kxcqt -f -

\if :{?titular}
\else
  \set titular 'cmvwyl1n0042m14kius4kxcqt'
\endif

\echo '== 1. Contratos do titular =='
SELECT k.numero, k.status, to_char(k."dataAssinatura", 'DD/MM/YYYY') AS assinado,
       k."valorEntrada" AS entrada, k."entradaParcelada" AS entrada_parcelada,
       to_char(k."createdAt" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS criado_no_sistema
  FROM contratos_credito k
  JOIN contas c ON c.id = k."contaId"
 WHERE c."titularId" = :'titular' AND k."deletedAt" IS NULL
 ORDER BY k."createdAt";

\echo '== 2. Faturas já vencidas ou pagas: valor, o que entrou e a cobrança =='
SELECT f.numero                                   AS fatura,
       to_char(f."dataVencimento", 'DD/MM/YYYY')  AS vencimento,
       f.status,
       f."valorTotal"                             AS valor,
       f."valorPago"                              AS pago,
       COALESCE(f."valorPago", 0) - f."valorTotal" AS pago_a_mais,
       to_char(f."dataPagamento" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS pago_em,
       COALESCE(f."asaasChargeId", '— sem cobrança —') AS cobranca_asaas,
       (SELECT string_agg(i.tipo || ' ' || i.valor || ' · ' || left(i.descricao, 38), E'\n' ORDER BY i.tipo)
          FROM itens_fatura i WHERE i."faturaId" = f.id) AS itens
  FROM faturas f
  JOIN contas c ON c.id = f."contaId"
 WHERE c."titularId" = :'titular' AND f."deletedAt" IS NULL
   AND (f."dataVencimento" < now() OR f.status IN ('PAGA', 'PAGA_EM_ATRASO'))
 ORDER BY f."dataVencimento", f.numero;

\echo '== 3. Parcelas dessas faturas: o que cada uma guarda de pagamento e de encargo =='
SELECT f.numero AS fatura, p.display AS parcela, p."valorNominal" AS nominal, p."valorPago" AS pago,
       p."valorEncargo" AS encargo, COALESCE(p.status::text, 'em aberto') AS status,
       to_char(p."dataPagamento" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS pago_em
  FROM parcelas p
  JOIN faturas f ON f.id = p."faturaId"
  JOIN contas c ON c.id = f."contaId"
 WHERE c."titularId" = :'titular' AND p."deletedAt" IS NULL AND f."dataVencimento" < now()
 ORDER BY f."dataVencimento", p.numero;

\echo '== 4. Base inteira: fatura só de intermediária, vencida e sem cobrança, com fatura paga A MAIS na mesma conta =='
WITH soltas AS (
  SELECT f.id, f."contaId", f.numero, f."dataVencimento", f."valorTotal"
    FROM faturas f
   WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA', 'FECHADA') AND f."dataVencimento" < now()
     AND f."asaasChargeId" IS NULL
     AND EXISTS (SELECT 1 FROM itens_fatura i WHERE i."faturaId" = f.id)
     AND NOT EXISTS (SELECT 1 FROM itens_fatura i WHERE i."faturaId" = f.id AND i.tipo <> 'INTERMEDIARIA')
)
SELECT t.nome                                     AS cliente,
       s.numero                                   AS fatura_intermediaria,
       to_char(s."dataVencimento", 'DD/MM/YYYY')  AS vencimento,
       s."valorTotal"                             AS valor_intermediaria,
       (SELECT string_agg('nº ' || p.numero || ': pago ' || p."valorPago" || ' de ' || p."valorTotal"
                          || ' em ' || to_char(p."dataPagamento" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM'), E'\n' ORDER BY p."dataVencimento")
          FROM faturas p
         WHERE p."contaId" = s."contaId" AND p."deletedAt" IS NULL AND p.status IN ('PAGA', 'PAGA_EM_ATRASO')
           AND COALESCE(p."valorPago", 0) - p."valorTotal" >= s."valorTotal") AS faturas_pagas_a_mais
  FROM soltas s
  JOIN contas c ON c.id = s."contaId"
  JOIN titulares t ON t.id = c."titularId"
 ORDER BY t.nome, s."dataVencimento";
