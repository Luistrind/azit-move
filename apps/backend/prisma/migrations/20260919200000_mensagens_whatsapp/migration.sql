-- Conversas do WhatsApp (doc 02 sec.24, opcao C, decisao Luis 19/09): o numero
-- dedicado fica so na API; respostas dos clientes sao atendidas no sistema.
-- Somente ADITIVA.
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
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE SET NULL ON UPDATE CASCADE;
