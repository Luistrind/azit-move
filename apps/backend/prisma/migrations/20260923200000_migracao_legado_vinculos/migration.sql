-- Migracao do legado (doc 02 sec.26.7): vinculos MANUAIS cobranca -> linha do
-- cronograma, decididos pelo operador na conciliacao. Somente ADITIVA.
ALTER TABLE "casos_migracao_legado"
  ADD COLUMN "vinculosManuais" JSONB;
