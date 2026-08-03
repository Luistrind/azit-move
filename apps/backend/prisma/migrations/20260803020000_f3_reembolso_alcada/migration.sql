-- F3 — Reembolso Parcelado: tipo de operação de alçada próprio (alçada por
-- produto, decisão 13/07). Aditivo.
INSERT INTO "tipos_operacao_alcada" ("id","chave","nome","aprovacoesNecessarias","ativo","createdAt","updatedAt")
SELECT 'toa_reembolso_parcelado','reembolso_parcelado','Reembolso Parcelado',1,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "tipos_operacao_alcada" WHERE "chave"='reembolso_parcelado');
