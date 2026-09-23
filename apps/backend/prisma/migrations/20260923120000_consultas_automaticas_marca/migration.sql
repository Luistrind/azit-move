-- Marca de consultas automaticas ja disparadas (23/09): impede o segundo
-- disparo enquanto o primeiro ainda esta na fila. Somente ADITIVA.
ALTER TABLE "analises_cadastro" ADD COLUMN "consultasAutomaticasEm" TIMESTAMP(3);
