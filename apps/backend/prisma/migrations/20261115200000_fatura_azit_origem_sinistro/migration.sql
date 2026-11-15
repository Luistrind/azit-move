-- Fatura Azit F2 (doc 02 §32.12 item 12): a indenização do sinistro que quita parcela de
-- fatura do modelo AZIT fica registrada como pagamento da fatura (PagamentoFatura +
-- AlocacaoPagamento), com origem própria. ADITIVA: só acrescenta um valor ao enum.
ALTER TYPE "OrigemPagamentoFatura" ADD VALUE 'SINISTRO';
