-- Pessoas/classificações + camada de capital (doc 02 §15). Aditivo.
CREATE TYPE "ClassificacaoTitular" AS ENUM ('INVESTIDOR','FORNECEDOR','PARCEIRO');
CREATE TYPE "TipoEstruturaJuridica" AS ENUM ('SPE','FUNDO','OUTRA');

CREATE TABLE "titular_classificacoes" (
    "id" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "classificacao" "ClassificacaoTitular" NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "titular_classificacoes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "titular_classificacoes_titularId_classificacao_key" ON "titular_classificacoes"("titularId","classificacao");
ALTER TABLE "titular_classificacoes" ADD CONSTRAINT "titular_classificacoes_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "estruturas_juridicas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoEstruturaJuridica" NOT NULL DEFAULT 'SPE',
    "cnpj" TEXT,
    "rodada" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "estruturas_juridicas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "investidores_estrutura" (
    "id" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "estruturaId" TEXT NOT NULL,
    "valorAportado" DECIMAL(14,2),
    "tipoInstrumento" TEXT NOT NULL DEFAULT 'MUTUO',
    "dataAporte" TIMESTAMP(3),
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "investidores_estrutura_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "investidores_estrutura_titularId_estruturaId_key" ON "investidores_estrutura"("titularId","estruturaId");
ALTER TABLE "investidores_estrutura" ADD CONSTRAINT "investidores_estrutura_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investidores_estrutura" ADD CONSTRAINT "investidores_estrutura_estruturaId_fkey" FOREIGN KEY ("estruturaId") REFERENCES "estruturas_juridicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "origens_capital" ADD COLUMN "estruturaId" TEXT;
ALTER TABLE "origens_capital" ADD CONSTRAINT "origens_capital_estruturaId_fkey" FOREIGN KEY ("estruturaId") REFERENCES "estruturas_juridicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
