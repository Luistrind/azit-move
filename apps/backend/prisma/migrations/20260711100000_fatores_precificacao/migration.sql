-- Reunião 11/07: fatores SEPARADOS — precificação (parcela exibida ÷4/÷2) ×
-- contrato (nº de parcelas ×4,345/×2,1725). Migration ADITIVA com defaults.
ALTER TABLE "versoes_parametros_simulacao"
  ADD COLUMN "fatorPrecificacaoSemanal" DECIMAL(8,4) NOT NULL DEFAULT 4,
  ADD COLUMN "fatorPrecificacaoQuinzenal" DECIMAL(8,4) NOT NULL DEFAULT 2;
