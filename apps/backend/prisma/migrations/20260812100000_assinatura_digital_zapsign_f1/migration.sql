-- Assinatura digital ZapSign F1 (doc 02 sec.21, autorizada 12/08): espelho do
-- documento na plataforma de assinatura, vinculado ao contrato ancora.
CREATE TABLE "documentos_assinatura" (
    "id" TEXT NOT NULL,
    "contratoCreditoId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 'zapsign',
    "docToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enviado',
    "signatarios" JSONB NOT NULL,
    "motivoRecusa" TEXT,
    "pdfAssinadoRef" TEXT,
    "simulado" BOOLEAN NOT NULL DEFAULT false,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "documentos_assinatura_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "documentos_assinatura_contratoCreditoId_key" ON "documentos_assinatura"("contratoCreditoId");
CREATE INDEX "documentos_assinatura_docToken_idx" ON "documentos_assinatura"("docToken");
ALTER TABLE "documentos_assinatura" ADD CONSTRAINT "documentos_assinatura_contratoCreditoId_fkey"
  FOREIGN KEY ("contratoCreditoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
