-- Conciliação do legado por SEQUÊNCIA + acordos confirmados (doc 02 §26.14, 06/10).
ALTER TABLE "casos_migracao_legado" ADD COLUMN "modoConciliacao" TEXT NOT NULL DEFAULT 'SEQUENCIA';
ALTER TABLE "casos_migracao_legado" ADD COLUMN "acordosConfirmados" JSONB;
-- Casos já validados ou migrados foram conciliados por DATA: não mudam de método sozinhos.
UPDATE "casos_migracao_legado" SET "modoConciliacao" = 'DATA' WHERE "status" IN ('VALIDADO', 'MIGRADO');
