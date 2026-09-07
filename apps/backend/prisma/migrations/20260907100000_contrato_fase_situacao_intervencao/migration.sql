-- Status do contrato em TRÊS camadas (doc 02 §5.2, decisão 2026-09-07):
-- fase gravada (Rascunho…Ativo, Encerrado+motivo), situação financeira CALCULADA
-- (inadimplente deixa de ser status) e intervenções paralelas (bloqueio,
-- recuperação, transferência) como carimbos. Migra o enum e converte os dados.

-- 1. Novos campos de intervenção + motivo NOVACAO (enum recriado — ADD VALUE não
--    pode ser usado na mesma transação da migração)
ALTER TABLE "contratos_credito" ADD COLUMN "veiculoBloqueadoEm" TIMESTAMP(3);
ALTER TABLE "contratos_credito" ADD COLUMN "recuperacaoIniciadaEm" TIMESTAMP(3);
ALTER TABLE "contratos_credito" ADD COLUMN "transferenciaEfetivadaEm" TIMESTAMP(3);
CREATE TYPE "MotivoEncerramento_novo" AS ENUM ('QUITACAO', 'NOVACAO', 'RESCISAO', 'CANCELAMENTO');
ALTER TABLE "contratos_credito" ALTER COLUMN "motivoEncerramento" TYPE "MotivoEncerramento_novo" USING ("motivoEncerramento"::text::"MotivoEncerramento_novo");
DROP TYPE "MotivoEncerramento";
ALTER TYPE "MotivoEncerramento_novo" RENAME TO "MotivoEncerramento";

-- 2. Converte os DADOS ainda no enum antigo:
--    INADIMPLENTE/SUSPENSO -> ATIVO (situação agora é calculada)
--    BLOQUEADO -> ATIVO + carimbo de bloqueio (updatedAt como melhor aproximação)
--    EM_RECUPERACAO_VEICULO -> ATIVO + carimbo de recuperação
--    CANCELADO -> ENCERRADO + motivo CANCELAMENTO
--    RESCINDIDO -> ENCERRADO + motivo RESCISAO
--    LIQUIDADO_POR_NOVACAO -> ENCERRADO + motivo NOVACAO
--    QUITADO_* -> ENCERRADO + motivo QUITACAO (+ carimbo de transferência no efetivado)
UPDATE "contratos_credito" SET "veiculoBloqueadoEm" = "updatedAt" WHERE "status" = 'BLOQUEADO';
UPDATE "contratos_credito" SET "recuperacaoIniciadaEm" = "updatedAt" WHERE "status" = 'EM_RECUPERACAO_VEICULO';
UPDATE "contratos_credito" SET "transferenciaEfetivadaEm" = "updatedAt" WHERE "status" = 'QUITADO_TRANSFERENCIA_EFETIVADA';
UPDATE "contratos_credito" SET "motivoEncerramento" = 'CANCELAMENTO', "dataEncerramento" = COALESCE("dataEncerramento", "updatedAt") WHERE "status" = 'CANCELADO';
UPDATE "contratos_credito" SET "motivoEncerramento" = 'RESCISAO', "dataEncerramento" = COALESCE("dataEncerramento", "updatedAt") WHERE "status" = 'RESCINDIDO';
UPDATE "contratos_credito" SET "motivoEncerramento" = 'NOVACAO', "dataEncerramento" = COALESCE("dataEncerramento", "updatedAt") WHERE "status" = 'LIQUIDADO_POR_NOVACAO';
UPDATE "contratos_credito" SET "motivoEncerramento" = 'QUITACAO', "dataEncerramento" = COALESCE("dataEncerramento", "updatedAt") WHERE "status" IN ('QUITADO_AGUARDANDO_TRANSFERENCIA', 'QUITADO_TRANSFERENCIA_EFETIVADA');

-- 3. Troca o tipo do enum: cria o novo, converte a coluna com CASE, remove o antigo.
CREATE TYPE "StatusContratoCredito_novo" AS ENUM ('RASCUNHO', 'AGUARDANDO_ASSINATURA', 'AGUARDANDO_PAGAMENTO_INICIAL', 'AGUARDANDO_ENTREGA_VEICULO', 'ATIVO', 'ENCERRADO');
ALTER TABLE "contratos_credito" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "contratos_credito" ALTER COLUMN "status" TYPE "StatusContratoCredito_novo"
  USING (CASE "status"::text
    WHEN 'INADIMPLENTE' THEN 'ATIVO'
    WHEN 'BLOQUEADO' THEN 'ATIVO'
    WHEN 'SUSPENSO' THEN 'ATIVO'
    WHEN 'EM_RECUPERACAO_VEICULO' THEN 'ATIVO'
    WHEN 'CANCELADO' THEN 'ENCERRADO'
    WHEN 'RESCINDIDO' THEN 'ENCERRADO'
    WHEN 'LIQUIDADO_POR_NOVACAO' THEN 'ENCERRADO'
    WHEN 'QUITADO_AGUARDANDO_TRANSFERENCIA' THEN 'ENCERRADO'
    WHEN 'QUITADO_TRANSFERENCIA_EFETIVADA' THEN 'ENCERRADO'
    ELSE "status"::text
  END)::"StatusContratoCredito_novo";
DROP TYPE "StatusContratoCredito";
ALTER TYPE "StatusContratoCredito_novo" RENAME TO "StatusContratoCredito";
ALTER TABLE "contratos_credito" ALTER COLUMN "status" SET DEFAULT 'RASCUNHO';
