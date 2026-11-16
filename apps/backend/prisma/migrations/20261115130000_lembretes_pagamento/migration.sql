-- WhatsApp enxuto — lembretes de pagamento D-2 e D0 (doc 02 §28; decisão Luís 2026-11-15).
-- Somente ADITIVA: o lembrete enviado (um por fatura por momento) e o lembrete
-- por titular (desligado por padrão; aviso do Asaas como decisão separada).

-- CreateEnum
CREATE TYPE "MomentoLembrete" AS ENUM ('D_MENOS_2', 'D_ZERO');

-- CreateEnum
CREATE TYPE "SituacaoLembrete" AS ENUM ('PREPARADO', 'ENVIADO', 'ENTREGUE', 'LIDO', 'FALHOU', 'SIMULADO', 'RETIDO');

-- CreateTable
CREATE TABLE "lembretes_pagamento" (
    "id" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "momento" "MomentoLembrete" NOT NULL,
    "diaReferencia" TEXT NOT NULL,
    "destino" TEXT,
    "texto" TEXT NOT NULL,
    "modeloNome" TEXT NOT NULL,
    "modeloIdioma" TEXT NOT NULL,
    "mensagemId" TEXT,
    "situacao" "SituacaoLembrete" NOT NULL DEFAULT 'PREPARADO',
    "motivo" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "lidoEm" TIMESTAMP(3),
    "falhaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lembretes_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lembretes_titular" (
    "id" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "ligadoEm" TIMESTAMP(3),
    "ligadoPorId" TEXT,
    "desligadoEm" TIMESTAMP(3),
    "desligadoPorId" TEXT,
    "asaasAvisoDesligado" BOOLEAN NOT NULL DEFAULT false,
    "asaasAvisoAlteradoEm" TIMESTAMP(3),
    "asaasAvisoAlteradoPorId" TEXT,
    "asaasAvisoPendente" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lembretes_titular_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lembretes_pagamento_mensagemId_key" ON "lembretes_pagamento"("mensagemId");

-- CreateIndex
CREATE INDEX "lembretes_pagamento_titularId_idx" ON "lembretes_pagamento"("titularId");

-- CreateIndex
CREATE INDEX "lembretes_pagamento_situacao_idx" ON "lembretes_pagamento"("situacao");

-- CreateIndex
CREATE UNIQUE INDEX "lembretes_pagamento_faturaId_momento_key" ON "lembretes_pagamento"("faturaId", "momento");

-- CreateIndex
CREATE UNIQUE INDEX "lembretes_titular_titularId_key" ON "lembretes_titular"("titularId");


-- AddForeignKey
ALTER TABLE "lembretes_pagamento" ADD CONSTRAINT "lembretes_pagamento_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "faturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lembretes_pagamento" ADD CONSTRAINT "lembretes_pagamento_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lembretes_titular" ADD CONSTRAINT "lembretes_titular_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
