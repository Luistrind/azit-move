-- Notificacoes formais de cobranca -- POP-COB-001 (doc 02 sec.23, decisao Luis 19/09).
-- Somente ADITIVA: colunas novas opcionais + tabelas novas.

-- Intervencoes do contrato (camada 3): retomada realizada e caso no juridico.
ALTER TABLE "contratos_credito" ADD COLUMN "veiculoRetomadoEm" TIMESTAMP(3);
ALTER TABLE "contratos_credito" ADD COLUMN "retomadaRegistro" JSONB;
ALTER TABLE "contratos_credito" ADD COLUMN "cobrancaJuridicaEm" TIMESTAMP(3);

-- Credenciais do WhatsApp (Cloud API oficial da Meta) na central de integracoes.
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappPhoneNumberId" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappWabaId" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappAccessToken" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappAppSecret" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappVerifyToken" TEXT;

CREATE TYPE "StatusNotificacaoCobranca" AS ENUM ('PREPARADA', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU', 'SIMULADA');

CREATE TABLE "casos_cobranca" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradoEm" TIMESTAMP(3),
    "motivoEncerramento" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "casos_cobranca_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "casos_cobranca_contratoId_idx" ON "casos_cobranca"("contratoId");
-- No maximo UM caso aberto por contrato (garante idempotencia da varredura
-- mesmo com duas replicas rodando ao mesmo tempo).
CREATE UNIQUE INDEX "casos_cobranca_um_aberto_por_contrato" ON "casos_cobranca"("contratoId") WHERE "encerradoEm" IS NULL;
ALTER TABLE "casos_cobranca" ADD CONSTRAINT "casos_cobranca_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "notificacoes_cobranca" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "etapa" INTEGER NOT NULL,
    "status" "StatusNotificacaoCobranca" NOT NULL DEFAULT 'PREPARADA',
    "disparo" TEXT NOT NULL,
    "usuarioId" TEXT,
    "destino" TEXT,
    "assunto" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "textoSha256" TEXT NOT NULL,
    "pdfRef" TEXT,
    "pdfSha256" TEXT,
    "dados" JSONB NOT NULL,
    "provedor" TEXT,
    "mensagemId" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "enviadaEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "lidaEm" TIMESTAMP(3),
    "falhaEm" TIMESTAMP(3),
    "falhaMotivo" TEXT,
    "eventos" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notificacoes_cobranca_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notificacoes_cobranca_mensagemId_key" ON "notificacoes_cobranca"("mensagemId");
CREATE UNIQUE INDEX "notificacoes_cobranca_casoId_etapa_key" ON "notificacoes_cobranca"("casoId", "etapa");
CREATE INDEX "notificacoes_cobranca_contratoId_idx" ON "notificacoes_cobranca"("contratoId");
ALTER TABLE "notificacoes_cobranca" ADD CONSTRAINT "notificacoes_cobranca_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "casos_cobranca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notificacoes_cobranca" ADD CONSTRAINT "notificacoes_cobranca_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "parametros_notificacao_cobranca" (
    "id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "modeloNome" TEXT NOT NULL DEFAULT 'azit_notificacao_cobranca',
    "modeloIdioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "textos" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parametros_notificacao_cobranca_pkey" PRIMARY KEY ("id")
);
