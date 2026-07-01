-- CreateTable
CREATE TABLE "itens_proposta" (
    "id" TEXT NOT NULL,
    "propostaId" TEXT NOT NULL,
    "produtoId" TEXT,
    "nome" TEXT NOT NULL,
    "natureza" "NaturezaProduto" NOT NULL,
    "apartado" BOOLEAN NOT NULL DEFAULT false,
    "valor" DECIMAL(12,2) NOT NULL,
    "periodicidade" "Periodicidade",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_proposta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itens_proposta_propostaId_idx" ON "itens_proposta"("propostaId");

-- AddForeignKey
ALTER TABLE "itens_proposta" ADD CONSTRAINT "itens_proposta_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "propostas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_proposta" ADD CONSTRAINT "itens_proposta_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

