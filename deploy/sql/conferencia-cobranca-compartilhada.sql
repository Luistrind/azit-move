-- Duas faturas, UMA cobrança: fatura que ficou em aberto no sistema porque a
-- cobrança que a pagou está ligada a outra fatura da mesma conta (caso Vinicius
-- Andre, 18/11/2026: parcela 3 + intermediária 3 numa cobrança só de R$ 1.005,00).
-- SÓ LEITURA. Saída curta.
--
--   git show origin/fix/intermediaria-paga-junto:deploy/sql/conferencia-cobranca-compartilhada.sql | \
--     docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -f -

\if :{?titular}
\else
  \set titular 'cmvwyl1n0042m14kius4kxcqt'
\endif

\echo '== A. As seis primeiras faturas do titular =='
SELECT f.numero AS fatura, to_char(f."dataVencimento", 'DD/MM/YYYY') AS vencimento, f.status,
       f."valorTotal" AS valor, f."valorPago" AS pago,
       to_char(f."dataPagamento" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS pago_em,
       COALESCE(f."asaasChargeId", '— sem cobrança —') AS cobranca,
       (SELECT string_agg(i.tipo || ' ' || i.valor, ' + ' ORDER BY i.tipo) FROM itens_fatura i WHERE i."faturaId" = f.id) AS itens
  FROM faturas f
  JOIN contas c ON c.id = f."contaId"
 WHERE c."titularId" = :'titular' AND f."deletedAt" IS NULL AND f.numero <= 6
 ORDER BY f.numero;

\echo '== B. Base inteira: cobranças ligadas a MAIS DE UMA fatura =='
SELECT t.nome AS cliente, f."asaasChargeId" AS cobranca,
       string_agg('nº ' || f.numero || ' ' || f.status || ' ' || f."valorTotal" || COALESCE(' (pago ' || f."valorPago" || ')', ''), '  |  ' ORDER BY f.numero) AS faturas
  FROM faturas f
  JOIN contas c ON c.id = f."contaId"
  JOIN titulares t ON t.id = c."titularId"
 WHERE f."deletedAt" IS NULL AND f."asaasChargeId" IS NOT NULL
 GROUP BY t.nome, f."asaasChargeId"
HAVING count(*) > 1
 ORDER BY t.nome;

\echo '== C. Base inteira: faturas SÓ de intermediária, vencidas e em aberto =='
SELECT t.nome AS cliente, f.numero AS fatura, to_char(f."dataVencimento", 'DD/MM/YYYY') AS vencimento,
       f."valorTotal" AS valor, COALESCE(f."asaasChargeId", '— sem cobrança —') AS cobranca,
       (SELECT string_agg('nº ' || o.numero || ' ' || o.status || ' ' || o."valorTotal" || COALESCE(' (pago ' || o."valorPago" || ')', ''), '  |  ' ORDER BY o.numero)
          FROM faturas o
         WHERE o."contaId" = f."contaId" AND o.id <> f.id AND o."deletedAt" IS NULL
           AND o."dataVencimento" = f."dataVencimento") AS outras_faturas_no_mesmo_vencimento
  FROM faturas f
  JOIN contas c ON c.id = f."contaId"
  JOIN titulares t ON t.id = c."titularId"
 WHERE f."deletedAt" IS NULL AND f.status IN ('ABERTA', 'FECHADA') AND f."dataVencimento" < now()
   AND EXISTS (SELECT 1 FROM itens_fatura i WHERE i."faturaId" = f.id)
   AND NOT EXISTS (SELECT 1 FROM itens_fatura i WHERE i."faturaId" = f.id AND i.tipo <> 'INTERMEDIARIA')
 ORDER BY t.nome, f."dataVencimento";
