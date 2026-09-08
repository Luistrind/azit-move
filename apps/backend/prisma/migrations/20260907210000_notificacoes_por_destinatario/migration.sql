-- Notificações com destinatário e leitura individual (doc 02 §16.1, 07/09).
-- lidaEm global sai; leituras viram por usuário. Notificações existentes ficam
-- sem destinatário (visíveis a todos) e não-lidas — o operador marca a sua.

CREATE TYPE "TipoNotificacao" AS ENUM ('APROVACAO', 'DINHEIRO', 'ASSINATURA', 'COBRANCA', 'FALHA', 'INFO');

ALTER TABLE "notificacoes" ADD COLUMN "tipo" "TipoNotificacao" NOT NULL DEFAULT 'INFO';
ALTER TABLE "notificacoes" ADD COLUMN "area" "AreaSistema";
ALTER TABLE "notificacoes" ADD COLUMN "usuarioId" TEXT;
ALTER TABLE "notificacoes" DROP COLUMN "lidaEm";

CREATE TABLE "notificacoes_lidas" (
    "notificacaoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notificacoes_lidas_pkey" PRIMARY KEY ("notificacaoId", "usuarioId")
);
CREATE INDEX "notificacoes_lidas_usuarioId_idx" ON "notificacoes_lidas"("usuarioId");
ALTER TABLE "notificacoes_lidas" ADD CONSTRAINT "notificacoes_lidas_notificacaoId_fkey" FOREIGN KEY ("notificacaoId") REFERENCES "notificacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notificacoes_usuarioId_idx" ON "notificacoes"("usuarioId");
CREATE INDEX "notificacoes_area_idx" ON "notificacoes"("area");
CREATE INDEX "notificacoes_createdAt_idx" ON "notificacoes"("createdAt");
