-- Dossiê para judicialização (doc 02 §30, pedido Luís 04/11/2026) + documentos da empresa.

-- CreateTable
CREATE TABLE "dossies_contrato" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "geradoPor" TEXT NOT NULL,
    "arquivoRef" TEXT NOT NULL,
    "paginas" INTEGER NOT NULL,
    "capturas" INTEGER NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "composicao" JSONB NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dossies_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros_empresa" (
    "id" TEXT NOT NULL,
    "contratoSocialRef" TEXT,
    "contratoSocialNome" TEXT,
    "contratoSocialDescricao" TEXT NOT NULL DEFAULT '',
    "contratoSocialEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_empresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dossies_contrato_contratoId_idx" ON "dossies_contrato"("contratoId");

-- AddForeignKey
ALTER TABLE "dossies_contrato" ADD CONSTRAINT "dossies_contrato_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
