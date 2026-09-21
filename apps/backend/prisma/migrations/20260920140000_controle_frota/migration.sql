-- Controle de frota (doc 02 sec.25, decisao Luis 20/09): observacao livre do
-- veiculo + ocorrencias (multas, IPVA, licenciamento) com desfecho e repasse.
-- O STATUS do ativo ja muda sozinho com o contrato; a operacao anota o resto
-- na observacao. Somente ADITIVA.
CREATE TYPE "TipoOcorrenciaVeiculo" AS ENUM ('MULTA', 'NOTIFICACAO', 'IPVA', 'LICENCIAMENTO', 'DPVAT', 'PEDAGIO', 'AVARIA', 'OUTRA');
CREATE TYPE "ResponsavelOcorrencia" AS ENUM ('CLIENTE', 'AZIT');
CREATE TYPE "StatusOcorrenciaVeiculo" AS ENUM ('REGISTRADA', 'EM_RECURSO', 'AGUARDANDO_COMPROVANTE', 'REPASSADA', 'ASSUMIDA_AZIT', 'QUITADA', 'CANCELADA');

ALTER TABLE "ativos" ADD COLUMN "observacao" TEXT;

CREATE TABLE "ocorrencias_veiculo" (
    "id" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "contratoId" TEXT,
    "tipo" "TipoOcorrenciaVeiculo" NOT NULL,
    "orgao" TEXT,
    "numeroAuto" TEXT,
    "descricao" TEXT,
    "dataFato" TIMESTAMP(3) NOT NULL,
    "dataVencimento" TIMESTAMP(3),
    "prazoIndicacao" TIMESTAMP(3),
    "valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorComDesconto" DECIMAL(12,2),
    "responsavel" "ResponsavelOcorrencia" NOT NULL,
    "responsavelJustificativa" TEXT,
    "status" "StatusOcorrenciaVeiculo" NOT NULL DEFAULT 'REGISTRADA',
    "desfechoEm" TIMESTAMP(3),
    "desfechoPor" TEXT,
    "desfechoObs" TEXT,
    "prazoComprovante" TIMESTAMP(3),
    "comprovanteRef" TEXT,
    "comprovanteEm" TIMESTAMP(3),
    "itemFaturaId" TEXT,
    "repasseContratoId" TEXT,
    "lancamentoCustoId" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'manual',
    "origemRef" TEXT,
    "bruto" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ocorrencias_veiculo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ocorrencias_veiculo_numeroAuto_key" ON "ocorrencias_veiculo"("numeroAuto");
CREATE UNIQUE INDEX "ocorrencias_veiculo_itemFaturaId_key" ON "ocorrencias_veiculo"("itemFaturaId");
CREATE UNIQUE INDEX "ocorrencias_veiculo_lancamentoCustoId_key" ON "ocorrencias_veiculo"("lancamentoCustoId");
CREATE INDEX "ocorrencias_veiculo_ativoId_idx" ON "ocorrencias_veiculo"("ativoId");
CREATE INDEX "ocorrencias_veiculo_contratoId_idx" ON "ocorrencias_veiculo"("contratoId");
CREATE INDEX "ocorrencias_veiculo_status_idx" ON "ocorrencias_veiculo"("status");
CREATE INDEX "ocorrencias_veiculo_dataFato_idx" ON "ocorrencias_veiculo"("dataFato");
ALTER TABLE "ocorrencias_veiculo" ADD CONSTRAINT "ocorrencias_veiculo_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ocorrencias_veiculo" ADD CONSTRAINT "ocorrencias_veiculo_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ocorrencias_veiculo" ADD CONSTRAINT "ocorrencias_veiculo_repasseContratoId_fkey" FOREIGN KEY ("repasseContratoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ocorrencias_veiculo" ADD CONSTRAINT "ocorrencias_veiculo_itemFaturaId_fkey" FOREIGN KEY ("itemFaturaId") REFERENCES "itens_fatura"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ocorrencias_veiculo" ADD CONSTRAINT "ocorrencias_veiculo_lancamentoCustoId_fkey" FOREIGN KEY ("lancamentoCustoId") REFERENCES "lancamentos_custo_ativo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
