-- Antecipação de parcela (planilha Vicente 11/07): taxa de desconto do CR.
ALTER TABLE "versoes_parametros_simulacao"
  ADD COLUMN "taxaDescontoAntecipacaoCR" DECIMAL(8,6) NOT NULL DEFAULT 0.2;
