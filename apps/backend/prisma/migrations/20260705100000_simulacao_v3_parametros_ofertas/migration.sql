-- Simulação V3 (Doc 2 §4-A.2/4-A.3, Decisão 2026-07-05): parâmetros versionados,
-- prazo em meses + frequência, estados/validade, oferta fixa, auditoria.
-- Migration ADITIVA com backfill — NÃO reseta dados.

-- 1) Enums novos.
CREATE TYPE "StatusSimulacao" AS ENUM ('RASCUNHO', 'CALCULADA', 'APRESENTADA', 'CONVERTIDA', 'CANCELADA');
CREATE TYPE "TipoOferta" AS ENUM ('OFERTA_FIXA', 'PADRAO', 'PERSONALIZADA');

-- 2) Parâmetros versionados do simulador + seed da 1ª versão (planilha do Vicente,
--    com fatores de conversão da reunião 04/07: 4,345 semanas/mês, quinzenal 2,1725).
CREATE TABLE "versoes_parametros_simulacao" (
    "id" TEXT NOT NULL,
    "comissaoInicial" DECIMAL(12,2) NOT NULL,
    "comissaoRecorrente" DECIMAL(12,2) NOT NULL,
    "taxaMensal" DECIMAL(8,6) NOT NULL,
    "entradaMinima" DECIMAL(12,2) NOT NULL,
    "prazoMinMeses" INTEGER NOT NULL,
    "prazoMaxMeses" INTEGER NOT NULL,
    "prazosPadronizados" TEXT NOT NULL,
    "fatorSemanal" DECIMAL(8,4) NOT NULL,
    "fatorQuinzenal" DECIMAL(8,4) NOT NULL,
    "validadeDias" INTEGER NOT NULL DEFAULT 7,
    "ofertasPadrao" JSONB NOT NULL,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versoes_parametros_simulacao_pkey" PRIMARY KEY ("id")
);

INSERT INTO "versoes_parametros_simulacao"
  ("id","comissaoInicial","comissaoRecorrente","taxaMensal","entradaMinima","prazoMinMeses","prazoMaxMeses","prazosPadronizados","fatorSemanal","fatorQuinzenal","validadeDias","ofertasPadrao")
VALUES (
  gen_random_uuid()::text, 3990.00, 599.00, 0.020000, 3990.00, 6, 48, '6,12,24,36,48', 4.3450, 2.1725, 7,
  '[{"prazoMeses":48,"frequencia":"SEMANAL","valorEntrada":399000},{"prazoMeses":36,"frequencia":"QUINZENAL","valorEntrada":599000},{"prazoMeses":12,"frequencia":"MENSAL","valorEntrada":999000}]'::jsonb
);

-- 3) Oferta fixa (condição comercial desenhada) + vínculo no ativo.
CREATE TABLE "ofertas_fixas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valorEntrada" DECIMAL(12,2) NOT NULL,
    "valorParcela" DECIMAL(12,2) NOT NULL,
    "frequencia" "Periodicidade" NOT NULL DEFAULT 'SEMANAL',
    "prazoMeses" INTEGER NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ofertas_fixas_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ativos" ADD COLUMN "ofertaFixaId" TEXT;
ALTER TABLE "ativos" ADD CONSTRAINT "ativos_ofertaFixaId_fkey"
  FOREIGN KEY ("ofertaFixaId") REFERENCES "ofertas_fixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Simulação V3: ativo opcional, valor à vista próprio, meses/frequência, estado,
--    validade e versão de parâmetros. Legado (prazoSemanas) vira nullable.
ALTER TABLE "simulacoes" ALTER COLUMN "ativoId" DROP NOT NULL;
ALTER TABLE "simulacoes" ALTER COLUMN "prazoSemanas" DROP NOT NULL;
ALTER TABLE "simulacoes" ADD COLUMN "valorAvista" DECIMAL(12,2);
ALTER TABLE "simulacoes" ADD COLUMN "valorAvistaManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "simulacoes" ADD COLUMN "prazoMeses" INTEGER;
ALTER TABLE "simulacoes" ADD COLUMN "status" "StatusSimulacao" NOT NULL DEFAULT 'RASCUNHO';
ALTER TABLE "simulacoes" ADD COLUMN "validaAte" TIMESTAMP(3);
ALTER TABLE "simulacoes" ADD COLUMN "parametroVersaoId" TEXT;
ALTER TABLE "simulacoes" ADD CONSTRAINT "simulacoes_parametroVersaoId_fkey"
  FOREIGN KEY ("parametroVersaoId") REFERENCES "versoes_parametros_simulacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "simulacoes_status_idx" ON "simulacoes"("status");
-- Backfill do legado: simulações antigas viram CALCULADA; convertidas em proposta, CONVERTIDA.
UPDATE "simulacoes" SET "status" = 'CALCULADA';
UPDATE "simulacoes" s SET "status" = 'CONVERTIDA'
  FROM "propostas" p WHERE p."simulacaoId" = s."id";

-- 5) Oferta: tipo + meses/frequência (legado prazoSemanas vira nullable).
ALTER TABLE "ofertas" ALTER COLUMN "prazoSemanas" DROP NOT NULL;
ALTER TABLE "ofertas" ADD COLUMN "tipo" "TipoOferta" NOT NULL DEFAULT 'PERSONALIZADA';
ALTER TABLE "ofertas" ADD COLUMN "prazoMeses" INTEGER;
ALTER TABLE "ofertas" ADD COLUMN "frequencia" "Periodicidade" NOT NULL DEFAULT 'SEMANAL';

-- 6) Proposta carrega a condição V3 (meses/frequência) para a conversão em contrato.
ALTER TABLE "propostas" ADD COLUMN "prazoMeses" INTEGER;
ALTER TABLE "propostas" ADD COLUMN "frequencia" "Periodicidade";

-- 7) Log de auditoria (ações críticas, antes/depois).
CREATE TABLE "logs_auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_auditoria_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "logs_auditoria_entidade_entidadeId_idx" ON "logs_auditoria"("entidade", "entidadeId");
CREATE INDEX "logs_auditoria_acao_idx" ON "logs_auditoria"("acao");
