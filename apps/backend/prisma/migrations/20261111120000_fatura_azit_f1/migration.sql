-- Fatura Azit F1 (doc 02 §32, decisão Luís 2026-11-09/11): token da página
-- pública por fatura, modelo de encargo (quem aplica multa/juros) e registro do
-- envio manual do link pelo operador.

CREATE TYPE "ModeloEncargoFatura" AS ENUM ('ASAAS_NATIVO', 'AZIT');
CREATE TYPE "CanalEnvioLinkFatura" AS ENUM ('WHATSAPP', 'COPIA');

ALTER TABLE "faturas" ADD COLUMN "tokenPublico" TEXT;
ALTER TABLE "faturas" ADD COLUMN "modeloEncargo" "ModeloEncargoFatura" NOT NULL DEFAULT 'ASAAS_NATIVO';

-- Histórico: toda fatura já existente ganha token (64 hex, ~244 bits de
-- aleatoriedade por gen_random_uuid, nativo do PostgreSQL 13+). Faturas novas
-- nascem com token gerado pelo sistema (novoTokenFatura).
UPDATE "faturas"
   SET "tokenPublico" = md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text)
 WHERE "tokenPublico" IS NULL;

CREATE UNIQUE INDEX "faturas_tokenPublico_key" ON "faturas"("tokenPublico");

CREATE TABLE "envios_link_fatura" (
    "id"        TEXT NOT NULL,
    "faturaId"  TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "canal"     "CanalEnvioLinkFatura" NOT NULL,
    "destino"   TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "envios_link_fatura_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "envios_link_fatura_faturaId_idx" ON "envios_link_fatura"("faturaId");
ALTER TABLE "envios_link_fatura" ADD CONSTRAINT "envios_link_fatura_faturaId_fkey"
    FOREIGN KEY ("faturaId") REFERENCES "faturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envios_link_fatura" ADD CONSTRAINT "envios_link_fatura_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
