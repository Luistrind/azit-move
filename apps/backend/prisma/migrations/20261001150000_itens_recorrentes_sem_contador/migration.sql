-- Itens recorrentes da fatura (protecao, taxa) sem contador de parcela
-- (pedido Luis 01/10). Corrige SOMENTE o texto ja gravado; as cobrancas ja
-- emitidas no Asaas mantem a descricao de quando foram emitidas.
UPDATE "itens_fatura" SET "descricao" = 'Proteção veicular'
 WHERE "tipo" = 'SERVICO' AND "descricao" LIKE 'Proteção veicular · %';
UPDATE "itens_fatura" SET "descricao" = 'Taxa de boleto e PIX'
 WHERE "tipo" = 'SERVICO' AND "descricao" LIKE 'Taxa de boleto e PIX · %';
