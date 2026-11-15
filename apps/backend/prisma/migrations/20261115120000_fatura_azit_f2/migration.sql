-- Fatura Azit F2 (doc 02 §32.4-A, §32.5, §32.8, §32.9 — decisões Luís 14–15/11/2026).
-- ADITIVA: só tipos e tabelas novos; nada muda em faturas existentes.
--   pagamentos_fatura / alocacoes_pagamento: baixa pela conta, por fatura, com o que cada valor quitou;
--   intencoes_pagamento: o Pix sob demanda (referência intencao:<id> no gateway);
--   parametros_faturamento: Configurações › Faturamento, versionado — sem linha, valem os
--   padrões provisórios com a chave do Pix sob demanda DESLIGADA.

-- CreateEnum
CREATE TYPE "OrigemPagamentoFatura" AS ENUM ('GATEWAY', 'CONFERENCIA');

-- CreateEnum
CREATE TYPE "TipoEncargoFatura" AS ENUM ('MULTA', 'ATUALIZACAO');

-- CreateEnum
CREATE TYPE "OrigemIntencaoPagamento" AS ENUM ('PAGINA_PUBLICA', 'OPERADOR');

-- CreateEnum
CREATE TYPE "SituacaoIntencaoPagamento" AS ENUM ('ATIVA', 'PAGA', 'EXPIRADA', 'SUBSTITUIDA');

-- CreateTable
CREATE TABLE "pagamentos_fatura" (
    "id" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "intencaoId" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "dataPagamento" TIMESTAMP(3) NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "origem" "OrigemPagamentoFatura" NOT NULL,
    "gatewayPaymentId" TEXT,
    "identificadorPix" TEXT,
    "valorExcedente" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_fatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alocacoes_pagamento" (
    "id" TEXT NOT NULL,
    "pagamentoId" TEXT NOT NULL,
    "itemFaturaId" TEXT,
    "tipoEncargo" "TipoEncargoFatura",
    "valor" DECIMAL(12,2) NOT NULL,
    "nivel" INTEGER NOT NULL,
    "quitou" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alocacoes_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intencoes_pagamento" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "faturasPretendidas" JSONB NOT NULL,
    "outroValor" BOOLEAN NOT NULL DEFAULT false,
    "dia" TEXT NOT NULL,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "origem" "OrigemIntencaoPagamento" NOT NULL,
    "usuarioId" TEXT,
    "situacao" "SituacaoIntencaoPagamento" NOT NULL DEFAULT 'ATIVA',
    "gatewayId" TEXT,
    "pixCopiaECola" TEXT,
    "pixQrCodeImagem" TEXT,
    "simulado" BOOLEAN NOT NULL DEFAULT false,
    "pagoEm" TIMESTAMP(3),
    "valorRecebido" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intencoes_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros_faturamento" (
    "id" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "pixSobDemanda" BOOLEAN NOT NULL DEFAULT false,
    "multaPadraoPct" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "atualizacaoMesPadraoPct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "cascata" JSONB NOT NULL,
    "minimoParcialPct" DECIMAL(5,2) NOT NULL DEFAULT 35,
    "minimoParcialPiso" DECIMAL(12,2) NOT NULL DEFAULT 200,
    "tetoIntencoesDia" INTEGER NOT NULL DEFAULT 10,
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parametros_faturamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagamentos_fatura_faturaId_idx" ON "pagamentos_fatura"("faturaId");

-- CreateIndex
CREATE INDEX "pagamentos_fatura_intencaoId_idx" ON "pagamentos_fatura"("intencaoId");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_fatura_gatewayPaymentId_faturaId_key" ON "pagamentos_fatura"("gatewayPaymentId", "faturaId");

-- CreateIndex
CREATE INDEX "alocacoes_pagamento_pagamentoId_idx" ON "alocacoes_pagamento"("pagamentoId");

-- CreateIndex
CREATE INDEX "alocacoes_pagamento_itemFaturaId_idx" ON "alocacoes_pagamento"("itemFaturaId");

-- CreateIndex
CREATE INDEX "intencoes_pagamento_contaId_situacao_idx" ON "intencoes_pagamento"("contaId", "situacao");

-- CreateIndex
CREATE INDEX "intencoes_pagamento_contaId_dia_idx" ON "intencoes_pagamento"("contaId", "dia");

-- CreateIndex
CREATE INDEX "intencoes_pagamento_gatewayId_idx" ON "intencoes_pagamento"("gatewayId");

-- CreateIndex
CREATE UNIQUE INDEX "parametros_faturamento_versao_key" ON "parametros_faturamento"("versao");

-- AddForeignKey
ALTER TABLE "pagamentos_fatura" ADD CONSTRAINT "pagamentos_fatura_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "faturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_fatura" ADD CONSTRAINT "pagamentos_fatura_intencaoId_fkey" FOREIGN KEY ("intencaoId") REFERENCES "intencoes_pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes_pagamento" ADD CONSTRAINT "alocacoes_pagamento_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "pagamentos_fatura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes_pagamento" ADD CONSTRAINT "alocacoes_pagamento_itemFaturaId_fkey" FOREIGN KEY ("itemFaturaId") REFERENCES "itens_fatura"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intencoes_pagamento" ADD CONSTRAINT "intencoes_pagamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intencoes_pagamento" ADD CONSTRAINT "intencoes_pagamento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_faturamento" ADD CONSTRAINT "parametros_faturamento_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

