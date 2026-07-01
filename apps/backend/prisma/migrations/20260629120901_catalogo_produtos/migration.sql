-- CreateTable
CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "natureza" "NaturezaProduto" NOT NULL,
    "credorPadrao" "Credor" NOT NULL DEFAULT 'AZIT',
    "apartado" BOOLEAN NOT NULL DEFAULT false,
    "valorPadrao" DECIMAL(12,2),
    "periodicidade" "Periodicidade",
    "ancora" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

