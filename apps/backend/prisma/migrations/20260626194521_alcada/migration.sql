-- CreateEnum
CREATE TYPE "TipoAlcada" AS ENUM ('RENEGOCIACAO', 'REAJUSTE', 'DESPESA');

-- CreateTable
CREATE TABLE "alcadas" (
    "id" TEXT NOT NULL,
    "tipo" "TipoAlcada" NOT NULL,
    "role" "RoleUsuario" NOT NULL,
    "limiteValor" DECIMAL(12,2),
    "nivel" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alcadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alcadas_tipo_idx" ON "alcadas"("tipo");
