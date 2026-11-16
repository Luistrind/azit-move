-- Fatura Azit F2 (doc 02 §32.4-A, decisão Luís 15/11): modo do Pix sob demanda.
-- ESTATICO = QR estático com valor (padrão); COBRANCA = cobrança Pix + consulta do
-- código (o modo anterior, mantido como opção de volta). Aditiva. As versões de
-- parâmetros já gravadas passam a mostrar ESTATICO (o padrão), embora os Pix
-- gerados antes desta migração tenham nascido como cobrança.

-- CreateEnum
CREATE TYPE "ModoPixSobDemanda" AS ENUM ('ESTATICO', 'COBRANCA');

-- AlterTable
ALTER TABLE "parametros_faturamento" ADD COLUMN "modoPix" "ModoPixSobDemanda" NOT NULL DEFAULT 'ESTATICO';
