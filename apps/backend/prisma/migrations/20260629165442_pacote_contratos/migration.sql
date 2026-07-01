-- AlterTable
ALTER TABLE "contratos_credito" ADD COLUMN     "propostaPacoteId" TEXT;

-- AddForeignKey
ALTER TABLE "contratos_credito" ADD CONSTRAINT "contratos_credito_propostaPacoteId_fkey" FOREIGN KEY ("propostaPacoteId") REFERENCES "propostas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

