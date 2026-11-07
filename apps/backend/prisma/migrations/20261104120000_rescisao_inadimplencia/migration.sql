-- Rescisão por inadimplência e recuperação do veículo (doc 02 §29, decisão Luís 04/11/2026).

-- CreateEnum
CREATE TYPE "StatusRescisao" AS ENUM ('PENDENTE', 'EFETIVADA', 'REPROVADA', 'CANCELADA');

-- AlterEnum: parcela e fatura extintas pela rescisão (Regra 3: nada se apaga).
ALTER TYPE "StatusFatura" ADD VALUE 'RESCINDIDA';
ALTER TYPE "StatusParcela" ADD VALUE 'RESCINDIDA';

-- CreateTable
CREATE TABLE "rescisoes_contrato" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "status" "StatusRescisao" NOT NULL DEFAULT 'PENDENTE',
    "dataBase" TIMESTAMP(3) NOT NULL,
    "observacao" TEXT,
    "solicitanteId" TEXT NOT NULL,
    "aprovadaPor" TEXT,
    "efetivadaEm" TIMESTAMP(3),
    "principalEntrada" DECIMAL(12,2) NOT NULL,
    "principalParcelas" DECIMAL(12,2) NOT NULL,
    "percentualCredito" DECIMAL(5,2) NOT NULL,
    "valorCredito" DECIMAL(12,2) NOT NULL,
    "dividaVencida" DECIMAL(12,2) NOT NULL,
    "encargosVencidos" DECIMAL(12,2) NOT NULL,
    "valorCompensado" DECIMAL(12,2) NOT NULL,
    "valorADevolver" DECIMAL(12,2) NOT NULL,
    "saldoRemanescente" DECIMAL(12,2) NOT NULL,
    "memoriaJson" JSONB NOT NULL,
    "devolvidoEm" TIMESTAMP(3),
    "devolucaoObservacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rescisoes_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rescisoes_contrato_contratoId_idx" ON "rescisoes_contrato"("contratoId");
CREATE INDEX "rescisoes_contrato_status_idx" ON "rescisoes_contrato"("status");

-- AddForeignKey
ALTER TABLE "rescisoes_contrato" ADD CONSTRAINT "rescisoes_contrato_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tipo de operação no motor de aprovação: UMA aprovação (decisão Luís 04/11). Aditivo.
INSERT INTO "tipos_operacao_alcada" ("id","chave","nome","aprovacoesNecessarias","ativo","createdAt","updatedAt")
SELECT 'toa_rescisao','rescisao','Rescisão por inadimplência',1,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "tipos_operacao_alcada" WHERE "chave"='rescisao');

-- Alçada de um aprovador: APROVADOR, DIRETOR e ADMIN sem limite (editável na tela de Alçadas).
INSERT INTO "alcadas" ("id","papel","tipoOperacao","limiteMinimo","limiteMaximo","ilimitado","ativo","createdAt","updatedAt")
SELECT v.id, v.papel::"RoleUsuario", 'rescisao', 0.00, 0.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('alc_resc_apr','APROVADOR'), ('alc_resc_dir','DIRETOR'), ('alc_resc_adm','ADMIN')) AS v(id,papel)
WHERE NOT EXISTS (SELECT 1 FROM "alcadas" a WHERE a."papel"=v.papel::"RoleUsuario" AND a."tipoOperacao"='rescisao');
