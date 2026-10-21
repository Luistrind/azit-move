-- Pedir complemento na Central de Aprovações (doc 02 §7.9-A, decisão Luís 21/10/2026 — sem prazo).
CREATE TABLE "aprovacao_complementos" (
    "id" TEXT NOT NULL,
    "aprovacaoId" TEXT NOT NULL,
    "pergunta" TEXT NOT NULL,
    "pedidoPorId" TEXT NOT NULL,
    "resposta" TEXT,
    "respondidoPorId" TEXT,
    "respondidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprovacao_complementos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "aprovacao_complementos_aprovacaoId_idx" ON "aprovacao_complementos"("aprovacaoId");

ALTER TABLE "aprovacao_complementos" ADD CONSTRAINT "aprovacao_complementos_aprovacaoId_fkey" FOREIGN KEY ("aprovacaoId") REFERENCES "aprovacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aprovacao_complementos" ADD CONSTRAINT "aprovacao_complementos_pedidoPorId_fkey" FOREIGN KEY ("pedidoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aprovacao_complementos" ADD CONSTRAINT "aprovacao_complementos_respondidoPorId_fkey" FOREIGN KEY ("respondidoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
