-- WhatsApp enxuto — canal (doc 02 §22 item 7, §23 e §24; decisão Luís 2026-11-15).
-- Somente ADITIVA: credenciais da Meta na central de integrações, parâmetros
-- versionados do canal e as mensagens trocadas com o cliente.

ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappPhoneNumberId" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappWabaId" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappAccessToken" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappAppSecret" TEXT;
ALTER TABLE "parametros_integracao" ADD COLUMN "whatsappVerifyToken" TEXT;

CREATE TABLE "parametros_whatsapp" (
    "id" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "numerosAutorizados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modeloD2Nome" TEXT NOT NULL DEFAULT 'azit_fatura_disponivel',
    "modeloD2Idioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "modeloD0Nome" TEXT NOT NULL DEFAULT 'azit_fatura_vence_hoje',
    "modeloD0Idioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parametros_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parametros_whatsapp_versao_key" ON "parametros_whatsapp"("versao");

CREATE TYPE "DirecaoMensagemWhatsapp" AS ENUM ('ENTRADA', 'SAIDA');

CREATE TABLE "mensagens_whatsapp" (
    "id" TEXT NOT NULL,
    "direcao" "DirecaoMensagemWhatsapp" NOT NULL,
    "numero" TEXT NOT NULL,
    "titularId" TEXT,
    "nomePerfil" TEXT,
    "mensagemId" TEXT,
    "tipo" TEXT NOT NULL,
    "texto" TEXT,
    "midiaId" TEXT,
    "midiaRef" TEXT,
    "midiaTipo" TEXT,
    "midiaNome" TEXT,
    "status" TEXT,
    "falhaMotivo" TEXT,
    "usuarioId" TEXT,
    "momento" TIMESTAMP(3) NOT NULL,
    "lidaEm" TIMESTAMP(3),
    "bruto" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mensagens_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mensagens_whatsapp_mensagemId_key" ON "mensagens_whatsapp"("mensagemId");
CREATE INDEX "mensagens_whatsapp_numero_momento_idx" ON "mensagens_whatsapp"("numero", "momento");
CREATE INDEX "mensagens_whatsapp_titularId_idx" ON "mensagens_whatsapp"("titularId");
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_titularId_fkey"
    FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE SET NULL ON UPDATE CASCADE;
