-- Vocabulário do domínio (doc 02 §2-A, decisão 2026-09-07): um conceito = um
-- nome. QUITADO do ativo -> TRANSFERIDO; QUITADO do acordo -> CUMPRIDO;
-- VENCIDA sai do enum de fatura (situação calculada — mesma cirurgia do
-- INADIMPLENTE do contrato). Nenhuma linha usava QUITADO nos dois primeiros;
-- faturas VENCIDA voltam a FECHADA (a fase real em que estavam).

-- StatusAtivo: QUITADO -> TRANSFERIDO
CREATE TYPE "StatusAtivo_novo" AS ENUM ('DISPONIVEL', 'EM_CONTRATO', 'TRANSFERIDO', 'RECUPERADO', 'SINISTRADO');
ALTER TABLE "ativos" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ativos" ALTER COLUMN "status" TYPE "StatusAtivo_novo"
  USING (CASE "status"::text WHEN 'QUITADO' THEN 'TRANSFERIDO' ELSE "status"::text END)::"StatusAtivo_novo";
DROP TYPE "StatusAtivo";
ALTER TYPE "StatusAtivo_novo" RENAME TO "StatusAtivo";
ALTER TABLE "ativos" ALTER COLUMN "status" SET DEFAULT 'DISPONIVEL';

-- StatusAcordo: QUITADO -> CUMPRIDO
CREATE TYPE "StatusAcordo_novo" AS ENUM ('RASCUNHO', 'AGUARDANDO_ENTRADA', 'ATIVO', 'CUMPRIDO', 'CANCELADO', 'EXPIRADO');
ALTER TABLE "acordos" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "acordos" ALTER COLUMN "status" TYPE "StatusAcordo_novo"
  USING (CASE "status"::text WHEN 'QUITADO' THEN 'CUMPRIDO' ELSE "status"::text END)::"StatusAcordo_novo";
DROP TYPE "StatusAcordo";
ALTER TYPE "StatusAcordo_novo" RENAME TO "StatusAcordo";
ALTER TABLE "acordos" ALTER COLUMN "status" SET DEFAULT 'RASCUNHO';

-- StatusFatura: VENCIDA sai (dados convertem para FECHADA — a fase real; a
-- situação "vencida" é derivada da data desde 30/08)
UPDATE "faturas" SET "status" = 'FECHADA' WHERE "status" = 'VENCIDA';
CREATE TYPE "StatusFatura_novo" AS ENUM ('ABERTA', 'FECHADA', 'PAGA', 'PAGA_EM_ATRASO', 'RENEGOCIADA');
ALTER TABLE "faturas" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "faturas" ALTER COLUMN "status" TYPE "StatusFatura_novo"
  USING ("status"::text::"StatusFatura_novo");
DROP TYPE "StatusFatura";
ALTER TYPE "StatusFatura_novo" RENAME TO "StatusFatura";
ALTER TABLE "faturas" ALTER COLUMN "status" SET DEFAULT 'ABERTA';
