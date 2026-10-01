-- Migracao do legado (doc 02 sec.26.9 item 4): vencimentos na migracao,
-- escolha POR CASO (CONTRATO | ASAAS). Somente ADITIVA.
ALTER TABLE "casos_migracao_legado"
  ADD COLUMN "modoVencimentos" TEXT NOT NULL DEFAULT 'CONTRATO';
