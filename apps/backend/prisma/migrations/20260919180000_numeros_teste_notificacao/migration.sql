-- Numero real unico em todos os ambientes (doc 02 sec.23 item 10, decisao Luis 19/09):
-- fora de producao so recebem mensagem de verdade os destinos desta lista.
ALTER TABLE "parametros_notificacao_cobranca" ADD COLUMN "numerosTeste" TEXT[] DEFAULT ARRAY[]::TEXT[];
