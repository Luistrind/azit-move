-- Pedir complemento SEM prazo (decisão Luís 21/10/2026, doc 02 §7.9-A): o pedido
-- só alerta quem solicitou e fica aberto até a resposta.
ALTER TABLE "aprovacao_complementos" DROP COLUMN "prazo";
