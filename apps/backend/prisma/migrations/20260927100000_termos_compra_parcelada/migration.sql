-- Vocabulario (doc 02 sec.2-A, decisao 27/09): o produto e COMPRA PARCELADA,
-- nunca "financiamento"; a protecao veicular nunca e "embutida".
-- Corrige SOMENTE o texto das descricoes ja gravadas (nenhum valor, status ou
-- vinculo muda), para que as proximas faturas/cobrancas saiam com o termo certo.
UPDATE "itens_contratados"
   SET "descricao" = 'Compra Parcelada ' || substring("descricao" from 15)
 WHERE "descricao" LIKE 'Financiamento %';

UPDATE "itens_fatura"
   SET "descricao" = replace("descricao", ' · Financiamento ', ' · Compra Parcelada ')
 WHERE "descricao" LIKE '% · Financiamento %';

UPDATE "itens_fatura"
   SET "descricao" = replace("descricao", 'Proteção veicular (embutida)', 'Proteção veicular')
 WHERE "descricao" LIKE 'Proteção veicular (embutida)%';
