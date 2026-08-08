-- Jornada do Atendimento (doc 02 sec.20, 08/08): upsell da protecao, renda
-- declarada, parecer do operador, camada 1 do biro, data prevista de ativacao
-- e notificacoes ao operador.
ALTER TABLE "propostas" ADD COLUMN "planoProtecao" TEXT NOT NULL DEFAULT 'essencial';
ALTER TABLE "propostas" ADD COLUMN "adicionalProtecao" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "propostas" ADD COLUMN "rendaDeclarada" DECIMAL(12,2);
ALTER TABLE "propostas" ADD COLUMN "parecerOperador" TEXT;
ALTER TABLE "propostas" ADD COLUMN "camada1Status" TEXT;
ALTER TABLE "propostas" ADD COLUMN "camada1Resultado" JSONB;

ALTER TABLE "contratos_credito" ADD COLUMN "dataPrevistaAtivacao" TIMESTAMP(3);

CREATE TABLE "notificacoes" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT,
    "rota" TEXT,
    "lidaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notificacoes_lidaEm_idx" ON "notificacoes"("lidaEm");
