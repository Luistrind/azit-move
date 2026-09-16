-- Bloco B da auditoria (decisao Luis 15/09): prazo de validade da assinatura/
-- entrada — instrumento nao assinado (ou entrada nao paga) alem do prazo
-- expira o contrato e libera o veiculo. Parametrizavel na tela
-- Configuracao > Assinatura digital (padrao 7 dias).
ALTER TABLE "parametros_assinatura" ADD COLUMN "validadeDias" INTEGER NOT NULL DEFAULT 7;
