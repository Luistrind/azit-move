-- Migracao do legado (doc 02 sec.26, decisao Luis 21/09): bancada de
-- conciliacao dos clientes que ja existem no Asaas. Somente ADITIVA.
CREATE TYPE "StatusCasoLegado" AS ENUM ('COLETADO', 'EM_REVISAO', 'VALIDADO', 'MIGRADO', 'DESCARTADO');
CREATE TYPE "SituacaoCasoLegado" AS ENUM ('SEM_VENCIDA', 'COM_VENCIDA', 'SEM_MOVIMENTO');

CREATE TABLE "casos_migracao_legado" (
    "id" TEXT NOT NULL,
    "asaasCustomerId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "status" "StatusCasoLegado" NOT NULL DEFAULT 'COLETADO',
    "situacao" "SituacaoCasoLegado" NOT NULL,
    "prioridade" INTEGER NOT NULL,
    "totalCobrancas" INTEGER NOT NULL DEFAULT 0,
    "cobrancasPagas" INTEGER NOT NULL DEFAULT 0,
    "cobrancasPendentes" INTEGER NOT NULL DEFAULT 0,
    "cobrancasVencidas" INTEGER NOT NULL DEFAULT 0,
    "cobrancasOutras" INTEGER NOT NULL DEFAULT 0,
    "valorParcelaPadrao" DECIMAL(12,2),
    "modeloSugerido" TEXT,
    "primeiraCobrancaEm" TIMESTAMP(3),
    "ultimaCobrancaEm" TIMESTAMP(3),
    "assinaturaId" TEXT,
    "assinaturaStatus" TEXT,
    "assinaturaValor" DECIMAL(12,2),
    "assinaturaCiclo" TEXT,
    "assinaturaProximoVencimento" TIMESTAMP(3),
    "assinaturaAtiva" BOOLEAN NOT NULL DEFAULT false,
    "clienteBruto" JSONB,
    "assinaturaBruto" JSONB,
    "observacao" TEXT,
    "statusAlteradoEm" TIMESTAMP(3),
    "statusAlteradoPor" TEXT,
    "coletadoEm" TIMESTAMP(3) NOT NULL,
    "titularId" TEXT,
    "contratoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "casos_migracao_legado_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "casos_migracao_legado_asaasCustomerId_key" ON "casos_migracao_legado"("asaasCustomerId");
CREATE UNIQUE INDEX "casos_migracao_legado_titularId_key" ON "casos_migracao_legado"("titularId");
CREATE UNIQUE INDEX "casos_migracao_legado_contratoId_key" ON "casos_migracao_legado"("contratoId");
CREATE INDEX "casos_migracao_legado_status_idx" ON "casos_migracao_legado"("status");
CREATE INDEX "casos_migracao_legado_situacao_prioridade_idx" ON "casos_migracao_legado"("situacao", "prioridade");
CREATE INDEX "casos_migracao_legado_cpfCnpj_idx" ON "casos_migracao_legado"("cpfCnpj");

CREATE TABLE "cobrancas_legadas" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "assinaturaId" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "valorPago" DECIMAL(12,2),
    "vencimento" TIMESTAMP(3) NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "tipo" TEXT,
    "descricao" TEXT,
    "invoiceUrl" TEXT,
    "deletada" BOOLEAN NOT NULL DEFAULT false,
    "bruto" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cobrancas_legadas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cobrancas_legadas_asaasPaymentId_key" ON "cobrancas_legadas"("asaasPaymentId");
CREATE INDEX "cobrancas_legadas_casoId_idx" ON "cobrancas_legadas"("casoId");
CREATE INDEX "cobrancas_legadas_vencimento_idx" ON "cobrancas_legadas"("vencimento");
ALTER TABLE "cobrancas_legadas" ADD CONSTRAINT "cobrancas_legadas_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "casos_migracao_legado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "coletas_legado" (
    "id" TEXT NOT NULL,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),
    "clientesLidos" INTEGER NOT NULL DEFAULT 0,
    "cobrancasLidas" INTEGER NOT NULL DEFAULT 0,
    "casosNovos" INTEGER NOT NULL DEFAULT 0,
    "casosAtualizados" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "ambiente" TEXT NOT NULL,
    "iniciadaPor" TEXT,
    CONSTRAINT "coletas_legado_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coletas_legado_iniciadaEm_idx" ON "coletas_legado"("iniciadaEm");
