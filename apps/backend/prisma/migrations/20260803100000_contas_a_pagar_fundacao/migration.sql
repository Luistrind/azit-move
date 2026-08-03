-- Contas a Pagar — fundação (doc 02 §18). Aditivo.
-- Área nova de permissão (o seed que USA o valor está na migration seguinte —
-- PostgreSQL não permite usar valor novo de enum na mesma transação).
ALTER TYPE "AreaSistema" ADD VALUE IF NOT EXISTS 'FINANCEIRO_ADMINISTRATIVO';

-- Alçadas: limite MÍNIMO por célula (decisão 1 de 03/08 — faixas por tipo).
ALTER TABLE "alcadas" ADD COLUMN "limiteMinimo" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TYPE "StatusFornecedorFin" AS ENUM ('EM_CADASTRO','AGUARDANDO_APROVACAO','ATIVO','BLOQUEADO','INATIVO');
CREATE TYPE "StatusTituloPagar" AS ENUM ('RASCUNHO','SOLICITADO','EM_VALIDACAO','DEVOLVIDO','AGUARDANDO_APROVACAO','APROVADO','PROGRAMADO','ENVIADO_BPO','AGUARDANDO_CORA','PAGO','CONCILIADO','CANCELADO','BLOQUEADO');
CREATE TYPE "StatusLotePagamento" AS ENUM ('EM_PREPARACAO','APROVADO','ENVIADO_BPO','CADASTRADO_CORA','AGUARDANDO_APROVACAO_BANCO','APROVADO_BANCO','PARCIALMENTE_PAGO','PAGO','CANCELADO');
CREATE TYPE "StatusConciliacaoTitulo" AS ENUM ('PENDENTE','CONCILIADA','DIVERGENTE','AJUSTADA');
CREATE TYPE "StatusOrcamentoCompra" AS ENUM ('EM_COTACAO','AGUARDANDO_APROVACAO','APROVADO','RECUSADO','CANCELADO','CONVERTIDO');
CREATE TYPE "UrgenciaDespesa" AS ENUM ('NORMAL','PRIORIDADE','EMERGENCIA');
CREATE TYPE "ResponsavelEconomico" AS ENUM ('AZIT','INVESTIDOR','CLIENTE','OUTRA_ENTIDADE');

CREATE TABLE "entidades_legais" (
    "id" TEXT NOT NULL, "razaoSocial" TEXT NOT NULL, "cnpj" TEXT, "unidadeNegocio" TEXT,
    "estruturaId" TEXT, "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "entidades_legais_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "entidades_legais_cnpj_key" ON "entidades_legais"("cnpj");

CREATE TABLE "contas_bancarias" (
    "id" TEXT NOT NULL, "entidadeId" TEXT NOT NULL, "banco" TEXT NOT NULL, "agencia" TEXT, "conta" TEXT,
    "tipo" TEXT, "finalidade" TEXT, "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "contas_bancarias_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contas_bancarias_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades_legais"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "fornecedores_financeiro" (
    "id" TEXT NOT NULL, "cpfCnpj" TEXT NOT NULL, "nome" TEXT NOT NULL, "contato" TEXT, "email" TEXT,
    "status" "StatusFornecedorFin" NOT NULL DEFAULT 'EM_CADASTRO', "titularId" TEXT,
    "alertaProximoPagamento" BOOLEAN NOT NULL DEFAULT false, "motivoBloqueio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "fornecedores_financeiro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fornecedores_financeiro_cpfCnpj_key" ON "fornecedores_financeiro"("cpfCnpj");

CREATE TABLE "fornecedores_dados_bancarios" (
    "id" TEXT NOT NULL, "fornecedorId" TEXT NOT NULL, "banco" TEXT, "agencia" TEXT, "conta" TEXT, "chavePix" TEXT,
    "versao" INTEGER NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT false, "criadoPor" TEXT, "aprovadoPor" TEXT, "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fornecedores_dados_bancarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fornecedores_dados_bancarios_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores_financeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "naturezas_financeiras" (
    "id" TEXT NOT NULL, "codigo" TEXT NOT NULL, "nome" TEXT NOT NULL,
    "exigeAtivo" BOOLEAN NOT NULL DEFAULT false, "exigeCotacao" BOOLEAN NOT NULL DEFAULT false,
    "especial" BOOLEAN NOT NULL DEFAULT false, "exigeJustificativa" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "naturezas_financeiras_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "naturezas_financeiras_codigo_key" ON "naturezas_financeiras"("codigo");

CREATE TABLE "centros_custo_areas" (
    "id" TEXT NOT NULL, "codigo" TEXT NOT NULL, "nome" TEXT NOT NULL,
    "responsavelUsuarioId" TEXT, "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "centros_custo_areas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "centros_custo_areas_codigo_key" ON "centros_custo_areas"("codigo");

CREATE TABLE "solicitacoes_orcamento" (
    "id" TEXT NOT NULL, "entidadeId" TEXT NOT NULL, "solicitanteId" TEXT, "descricao" TEXT NOT NULL,
    "naturezaId" TEXT, "centroCustoAreaId" TEXT, "ativoId" TEXT,
    "urgencia" "UrgenciaDespesa" NOT NULL DEFAULT 'NORMAL',
    "status" "StatusOrcamentoCompra" NOT NULL DEFAULT 'EM_COTACAO',
    "justificativaDispensa" TEXT, "decisaoMotivo" TEXT, "tituloGeradoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "solicitacoes_orcamento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orcamentos_fornecedor" (
    "id" TEXT NOT NULL, "solicitacaoId" TEXT NOT NULL, "fornecedorId" TEXT, "nomeFornecedor" TEXT,
    "valor" DECIMAL(12,2) NOT NULL, "prazo" TEXT, "garantia" TEXT, "condicao" TEXT,
    "selecionado" BOOLEAN NOT NULL DEFAULT false, "motivoSelecao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orcamentos_fornecedor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orcamentos_fornecedor_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes_orcamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "lotes_pagamento" (
    "id" TEXT NOT NULL, "entidadeId" TEXT NOT NULL, "contaBancariaId" TEXT NOT NULL,
    "dataProgramada" TIMESTAMP(3) NOT NULL, "versao" INTEGER NOT NULL DEFAULT 1,
    "status" "StatusLotePagamento" NOT NULL DEFAULT 'EM_PREPARACAO',
    "totalValor" DECIMAL(12,2) NOT NULL DEFAULT 0, "totalItens" INTEGER NOT NULL DEFAULT 0,
    "urgente" BOOLEAN NOT NULL DEFAULT false, "enviadoEm" TIMESTAMP(3), "enviadoPor" TEXT, "resumoRef" TEXT, "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lotes_pagamento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lotes_pagamento_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades_legais"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lotes_pagamento_contaBancariaId_fkey" FOREIGN KEY ("contaBancariaId") REFERENCES "contas_bancarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "titulos_pagar" (
    "id" TEXT NOT NULL, "entidadeId" TEXT NOT NULL, "fornecedorId" TEXT NOT NULL, "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL, "vencimento" TIMESTAMP(3) NOT NULL, "competencia" TEXT,
    "naturezaId" TEXT NOT NULL, "centroCustoAreaId" TEXT NOT NULL,
    "responsavelEconomico" "ResponsavelEconomico" NOT NULL DEFAULT 'AZIT',
    "formaPagamento" TEXT NOT NULL DEFAULT 'pix',
    "status" "StatusTituloPagar" NOT NULL DEFAULT 'RASCUNHO',
    "urgente" BOOLEAN NOT NULL DEFAULT false, "justificativaUrgencia" TEXT, "justificativaNatureza" TEXT,
    "ativoId" TEXT, "contratoCreditoId" TEXT, "origemSolicitacaoId" TEXT, "dadosBancariosId" TEXT,
    "loteId" TEXT, "dataProgramada" TIMESTAMP(3),
    "motivoDevolucao" TEXT, "motivoBloqueio" TEXT, "motivoCancelamento" TEXT,
    "prazoPrestacaoContas" TIMESTAMP(3), "prestacaoContasEm" TIMESTAMP(3), "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "titulos_pagar_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "titulos_pagar_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades_legais"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "titulos_pagar_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores_financeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "titulos_pagar_naturezaId_fkey" FOREIGN KEY ("naturezaId") REFERENCES "naturezas_financeiras"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "titulos_pagar_centroCustoAreaId_fkey" FOREIGN KEY ("centroCustoAreaId") REFERENCES "centros_custo_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "titulos_pagar_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes_pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "titulos_pagar_status_idx" ON "titulos_pagar"("status");
CREATE INDEX "titulos_pagar_entidadeId_idx" ON "titulos_pagar"("entidadeId");

CREATE TABLE "documentos_titulo" (
    "id" TEXT NOT NULL, "tituloId" TEXT NOT NULL, "tipo" TEXT NOT NULL, "nome" TEXT NOT NULL, "arquivoRef" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1, "ativo" BOOLEAN NOT NULL DEFAULT true, "motivoSubstituicao" TEXT, "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documentos_titulo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documentos_titulo_tituloId_fkey" FOREIGN KEY ("tituloId") REFERENCES "titulos_pagar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "pagamentos_titulo" (
    "id" TEXT NOT NULL, "tituloId" TEXT NOT NULL, "loteId" TEXT, "dataEfetiva" TIMESTAMP(3) NOT NULL,
    "valorEfetivo" DECIMAL(12,2) NOT NULL, "identificador" TEXT, "comprovanteNome" TEXT, "comprovanteRef" TEXT,
    "divergencia" TEXT, "registradoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pagamentos_titulo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pagamentos_titulo_tituloId_fkey" FOREIGN KEY ("tituloId") REFERENCES "titulos_pagar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "conciliacoes_titulo" (
    "id" TEXT NOT NULL, "pagamentoId" TEXT NOT NULL, "dataSaida" TIMESTAMP(3) NOT NULL,
    "valorExtrato" DECIMAL(12,2) NOT NULL, "evidenciaRef" TEXT,
    "status" "StatusConciliacaoTitulo" NOT NULL DEFAULT 'PENDENTE', "observacao" TEXT, "responsavelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conciliacoes_titulo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conciliacoes_titulo_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "pagamentos_titulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "conciliacoes_titulo_pagamentoId_key" ON "conciliacoes_titulo"("pagamentoId");
