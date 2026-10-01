-- Tabela FIPE oficial no ativo (doc 02 sec.26.11): prova da consulta. ADITIVA.
ALTER TABLE "ativos"
  ADD COLUMN "fipeCodigo" TEXT,
  ADD COLUMN "fipeModelo" TEXT,
  ADD COLUMN "fipeReferencia" TEXT,
  ADD COLUMN "fipeConsultadaEm" TIMESTAMP(3);
