-- CreateEnum
CREATE TYPE "StatusNovacao" AS ENUM ('RASCUNHO', 'ATIVO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CanalOrigem" AS ENUM ('OPERADOR_INTERNO', 'LANDING_PAGE', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusProposta" AS ENUM ('PENDENTE', 'EM_ANALISE', 'APROVADA', 'REPROVADA', 'CANCELADA', 'EM_FORMALIZACAO', 'CONVERTIDA');

-- CreateEnum
CREATE TYPE "ModalidadeContrato" AS ENUM ('ASSINATURA', 'COMPRA_PARCELADA', 'COMPRA_VISTA');

-- CreateEnum
CREATE TYPE "PapelTitular" AS ENUM ('COMPRADOR_PRINCIPAL', 'COMPRADOR_SECUNDARIO', 'GARANTIDOR');

-- CreateEnum
CREATE TYPE "TipoDocumentoProposta" AS ENUM ('CNH', 'COMPROVANTE_ENDERECO', 'COMPROVANTE_RENDA', 'RELATORIO_BRICK', 'OUTRO');

-- CreateEnum
CREATE TYPE "ResultadoParecer" AS ENUM ('APROVADO', 'APROVADO_COM_RESSALVAS', 'REPROVADO');

-- CreateEnum
CREATE TYPE "OrigemCalculoOferta" AS ENUM ('PACOTE_GENERICO', 'VALOR_VENDA_ATIVO');

-- AlterEnum (conservador: renomeia o valor preservando dados — Doc: RENEGOCIACAO -> ACORDO)
ALTER TYPE "OrigemItemContratado" RENAME VALUE 'RENEGOCIACAO' TO 'ACORDO';

-- AlterEnum
ALTER TYPE "StatusContratoCredito" ADD VALUE 'LIQUIDADO_POR_NOVACAO';

-- AlterEnum
ALTER TYPE "TipoItemFatura" ADD VALUE 'INTERMEDIARIA';

-- DropForeignKey
ALTER TABLE "intervenientes_garantidores" DROP CONSTRAINT "intervenientes_garantidores_titularId_fkey";

-- DropForeignKey
ALTER TABLE "itens_fatura" DROP CONSTRAINT "itens_fatura_parcelaId_fkey";

-- DropIndex
DROP INDEX "alcadas_tipo_idx";

-- DropIndex
DROP INDEX "contratos_credito_pophubId_idx";

-- AlterTable (alcadas é config placeholder, reSemeada — limpa antes de adicionar colunas NOT NULL)
DELETE FROM "alcadas";
ALTER TABLE "alcadas" DROP COLUMN "limiteValor",
DROP COLUMN "nivel",
DROP COLUMN "role",
DROP COLUMN "tipo",
ADD COLUMN     "limiteMaximo" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "tipoOperacao" TEXT NOT NULL,
ADD COLUMN     "usuarioId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ativos" ADD COLUMN     "pacoteOfertaId" TEXT,
ADD COLUMN     "valorVenda" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "contratos_credito" DROP COLUMN "pophubId",
ADD COLUMN     "snapshotJson" JSONB,
ADD COLUMN     "snapshotLockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "itens_fatura" ALTER COLUMN "parcelaId" DROP NOT NULL;

-- DropTable
DROP TABLE "intervenientes_garantidores";

-- DropEnum
DROP TYPE "TipoAlcada";

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "dataNascimento" TIMESTAMP(3),
    "canalOrigem" "CanalOrigem" NOT NULL DEFAULT 'OPERADOR_INTERNO',
    "titularId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulacoes" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "titularId" TEXT,
    "ativoId" TEXT NOT NULL,
    "valorEntrada" DECIMAL(12,2) NOT NULL,
    "prazoSemanas" INTEGER NOT NULL,
    "periodicidade" "Periodicidade" NOT NULL DEFAULT 'SEMANAL',
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas" (
    "id" TEXT NOT NULL,
    "simulacaoId" TEXT NOT NULL,
    "origemCalculo" "OrigemCalculoOferta" NOT NULL,
    "valorEntrada" DECIMAL(12,2) NOT NULL,
    "entradaParcelada" BOOLEAN NOT NULL DEFAULT false,
    "prazoSemanas" INTEGER NOT NULL,
    "valorParcela" DECIMAL(12,2) NOT NULL,
    "numeroParcelas" INTEGER NOT NULL,
    "selecionada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ofertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propostas" (
    "id" TEXT NOT NULL,
    "simulacaoId" TEXT,
    "titularId" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "modalidade" "ModalidadeContrato" NOT NULL DEFAULT 'COMPRA_PARCELADA',
    "valorEntrada" DECIMAL(12,2) NOT NULL,
    "prazoSemanas" INTEGER NOT NULL,
    "valorParcela" DECIMAL(12,2) NOT NULL,
    "numeroParcelas" INTEGER NOT NULL,
    "status" "StatusProposta" NOT NULL DEFAULT 'PENDENTE',
    "contratoGeradoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "propostas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculos_papel" (
    "id" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "papel" "PapelTitular" NOT NULL,
    "propostaId" TEXT,
    "contratoCreditoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vinculos_papel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_proposta" (
    "id" TEXT NOT NULL,
    "propostaId" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "tipo" "TipoDocumentoProposta" NOT NULL,
    "arquivoRef" TEXT NOT NULL,
    "dataAnexo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_proposta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pareceres" (
    "id" TEXT NOT NULL,
    "propostaId" TEXT NOT NULL,
    "resultado" "ResultadoParecer" NOT NULL,
    "motivoReprovacao" TEXT,
    "exigeGarantidor" BOOLEAN NOT NULL DEFAULT false,
    "analistaId" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pareceres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novacoes" (
    "id" TEXT NOT NULL,
    "contratoOrigemId" TEXT NOT NULL,
    "contratoNovoId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "dataEfetivacao" TIMESTAMP(3),
    "saldoLiquidado" DECIMAL(12,2) NOT NULL,
    "status" "StatusNovacao" NOT NULL DEFAULT 'RASCUNHO',
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "novacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_cpf_idx" ON "leads"("cpf");

-- CreateIndex
CREATE INDEX "leads_titularId_idx" ON "leads"("titularId");

-- CreateIndex
CREATE INDEX "simulacoes_ativoId_idx" ON "simulacoes"("ativoId");

-- CreateIndex
CREATE INDEX "simulacoes_leadId_idx" ON "simulacoes"("leadId");

-- CreateIndex
CREATE INDEX "ofertas_simulacaoId_idx" ON "ofertas"("simulacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "propostas_simulacaoId_key" ON "propostas"("simulacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "propostas_contratoGeradoId_key" ON "propostas"("contratoGeradoId");

-- CreateIndex
CREATE INDEX "propostas_titularId_idx" ON "propostas"("titularId");

-- CreateIndex
CREATE INDEX "propostas_status_idx" ON "propostas"("status");

-- CreateIndex
CREATE INDEX "vinculos_papel_propostaId_idx" ON "vinculos_papel"("propostaId");

-- CreateIndex
CREATE INDEX "vinculos_papel_contratoCreditoId_idx" ON "vinculos_papel"("contratoCreditoId");

-- CreateIndex
CREATE UNIQUE INDEX "vinculos_papel_titularId_propostaId_key" ON "vinculos_papel"("titularId", "propostaId");

-- CreateIndex
CREATE INDEX "documentos_proposta_propostaId_idx" ON "documentos_proposta"("propostaId");

-- CreateIndex
CREATE UNIQUE INDEX "pareceres_propostaId_key" ON "pareceres"("propostaId");

-- CreateIndex
CREATE UNIQUE INDEX "novacoes_contratoOrigemId_key" ON "novacoes"("contratoOrigemId");

-- CreateIndex
CREATE UNIQUE INDEX "novacoes_contratoNovoId_key" ON "novacoes"("contratoNovoId");

-- CreateIndex
CREATE INDEX "novacoes_operadorId_idx" ON "novacoes"("operadorId");

-- CreateIndex
CREATE INDEX "alcadas_usuarioId_idx" ON "alcadas"("usuarioId");

-- CreateIndex
CREATE INDEX "alcadas_tipoOperacao_idx" ON "alcadas"("tipoOperacao");

-- CreateIndex
CREATE INDEX "ativos_status_idx" ON "ativos"("status");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulacoes" ADD CONSTRAINT "simulacoes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulacoes" ADD CONSTRAINT "simulacoes_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulacoes" ADD CONSTRAINT "simulacoes_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_simulacaoId_fkey" FOREIGN KEY ("simulacaoId") REFERENCES "simulacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_simulacaoId_fkey" FOREIGN KEY ("simulacaoId") REFERENCES "simulacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_contratoGeradoId_fkey" FOREIGN KEY ("contratoGeradoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_papel" ADD CONSTRAINT "vinculos_papel_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_papel" ADD CONSTRAINT "vinculos_papel_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "propostas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_papel" ADD CONSTRAINT "vinculos_papel_contratoCreditoId_fkey" FOREIGN KEY ("contratoCreditoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_proposta" ADD CONSTRAINT "documentos_proposta_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "propostas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_proposta" ADD CONSTRAINT "documentos_proposta_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pareceres" ADD CONSTRAINT "pareceres_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "propostas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_fatura" ADD CONSTRAINT "itens_fatura_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "parcelas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novacoes" ADD CONSTRAINT "novacoes_contratoOrigemId_fkey" FOREIGN KEY ("contratoOrigemId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novacoes" ADD CONSTRAINT "novacoes_contratoNovoId_fkey" FOREIGN KEY ("contratoNovoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novacoes" ADD CONSTRAINT "novacoes_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alcadas" ADD CONSTRAINT "alcadas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

