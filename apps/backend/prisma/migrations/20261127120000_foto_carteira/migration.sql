-- Doc 02 §27.12 (decisão Luís 2026-11-27): foto do início do mês da Carteira.
-- Aditiva: duas tabelas novas, nada existente muda.

CREATE TABLE "fotos_carteira" (
    "id" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "tiradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fotos_carteira_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fotos_carteira_mes_key" ON "fotos_carteira"("mes");

CREATE TABLE "fotos_carteira_faturas" (
    "id" TEXT NOT NULL,
    "fotoId" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "vencimento" DATE NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "valorPago" DECIMAL(12,2),
    "itens" JSONB NOT NULL,
    CONSTRAINT "fotos_carteira_faturas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fotos_carteira_faturas_fotoId_idx" ON "fotos_carteira_faturas"("fotoId");
ALTER TABLE "fotos_carteira_faturas" ADD CONSTRAINT "fotos_carteira_faturas_fotoId_fkey" FOREIGN KEY ("fotoId") REFERENCES "fotos_carteira"("id") ON DELETE CASCADE ON UPDATE CASCADE;
