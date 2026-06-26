-- CreateEnum
CREATE TYPE "TipoPessoa" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "StatusTitular" AS ENUM ('ATIVO', 'INATIVO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "StatusConta" AS ENUM ('ATIVA', 'SUSPENSA', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "TipoAtivo" AS ENUM ('VEICULO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusAtivo" AS ENUM ('DISPONIVEL', 'EM_CONTRATO', 'QUITADO', 'RECUPERADO', 'SINISTRADO');

-- CreateEnum
CREATE TYPE "TipoCombustivel" AS ENUM ('FLEX', 'GASOLINA', 'ELETRICO', 'DIESEL', 'HIBRIDO');

-- CreateEnum
CREATE TYPE "OrigemAtivo" AS ENUM ('LOCADORA', 'PARTICULAR', 'CONCESSIONARIA');

-- CreateEnum
CREATE TYPE "TipoOrigemCapital" AS ENUM ('CAPITAL_PROPRIO', 'EMPRESTIMO', 'INVESTIDOR_ATIVO', 'FUNDO');

-- CreateEnum
CREATE TYPE "StatusOrigemCapital" AS ENUM ('ATIVO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "ModeloInvestimento" AS ENUM ('ATIVO_ESPECIFICO', 'FUNDO_COLETIVO', 'FUNDO_EXCLUSIVO');

-- CreateEnum
CREATE TYPE "StatusContratoInvestimento" AS ENUM ('ATIVO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "Periodicidade" AS ENUM ('SEMANAL', 'QUINZENAL', 'MENSAL');

-- CreateEnum
CREATE TYPE "StatusContratoCredito" AS ENUM ('RASCUNHO', 'AGUARDANDO_ASSINATURA', 'AGUARDANDO_PAGAMENTO_INICIAL', 'AGUARDANDO_ENTREGA_VEICULO', 'ATIVO', 'INADIMPLENTE', 'BLOQUEADO', 'SUSPENSO', 'EM_RECUPERACAO_VEICULO', 'CANCELADO', 'RESCINDIDO', 'QUITADO_AGUARDANDO_TRANSFERENCIA', 'QUITADO_TRANSFERENCIA_EFETIVADA');

-- CreateEnum
CREATE TYPE "MotivoEncerramento" AS ENUM ('QUITACAO', 'RESCISAO', 'CANCELAMENTO');

-- CreateEnum
CREATE TYPE "NaturezaProduto" AS ENUM ('RECORRENTE', 'PARCELADO');

-- CreateEnum
CREATE TYPE "OrigemItemContratado" AS ENUM ('VENDA', 'RENEGOCIACAO');

-- CreateEnum
CREATE TYPE "Credor" AS ENUM ('AZIT', 'INVESTIDOR', 'TERCEIRO');

-- CreateEnum
CREATE TYPE "StatusItemContratado" AS ENUM ('ATIVO', 'ENCERRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusParcela" AS ENUM ('PAGA', 'PAGA_EM_ATRASO', 'PAGA_ANTECIPADA', 'RENEGOCIADA', 'CANCELADA', 'ESTORNADA', 'SUSPENSA');

-- CreateEnum
CREATE TYPE "StatusFatura" AS ENUM ('ABERTA', 'FECHADA', 'VENCIDA', 'PAGA', 'PAGA_EM_ATRASO', 'RENEGOCIADA');

-- CreateEnum
CREATE TYPE "TipoItemFatura" AS ENUM ('PRINCIPAL', 'SERVICO', 'ENCARGO');

-- CreateEnum
CREATE TYPE "StatusRecebivel" AS ENUM ('ESPERADO', 'REALIZADO', 'RENEGOCIADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusAcordo" AS ENUM ('RASCUNHO', 'ATIVO', 'QUITADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusReajuste" AS ENUM ('PENDENTE', 'APROVADO', 'APLICADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "RoleUsuario" AS ENUM ('DIRETOR', 'ADMIN', 'APROVADOR', 'OPERADOR', 'FINANCEIRO');

-- CreateTable
CREATE TABLE "titulares" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipoPessoa" "TipoPessoa" NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "rg" TEXT,
    "estadoCivil" TEXT,
    "profissao" TEXT,
    "whatsapp" TEXT NOT NULL,
    "email" TEXT,
    "endereco" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "asaasCustomerId" TEXT,
    "status" "StatusTitular" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "titulares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intervenientes_garantidores" (
    "id" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "rg" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intervenientes_garantidores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas" (
    "id" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "dataAbertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusConta" NOT NULL DEFAULT 'ATIVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ativos" (
    "id" TEXT NOT NULL,
    "tipo" "TipoAtivo" NOT NULL DEFAULT 'VEICULO',
    "descricao" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "anoFabricacao" INTEGER,
    "anoModelo" INTEGER,
    "cor" TEXT,
    "placa" TEXT,
    "chassi" TEXT,
    "renavam" TEXT,
    "origem" "OrigemAtivo",
    "combustivel" "TipoCombustivel",
    "quilometragemEntrada" INTEGER,
    "valorAquisicao" DECIMAL(12,2),
    "status" "StatusAtivo" NOT NULL DEFAULT 'DISPONIVEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ativos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "origens_capital" (
    "id" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "tipo" "TipoOrigemCapital" NOT NULL,
    "contratoInvestimentoId" TEXT,
    "valorAportado" DECIMAL(12,2) NOT NULL,
    "taxaRetorno" DECIMAL(8,6),
    "dataAporte" TIMESTAMP(3) NOT NULL,
    "status" "StatusOrigemCapital" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "origens_capital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos_investimento" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "modelo" "ModeloInvestimento" NOT NULL,
    "valorAportado" DECIMAL(12,2) NOT NULL,
    "taxaRetorno" DECIMAL(8,6),
    "dataAporte" TIMESTAMP(3) NOT NULL,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataVencimento" TIMESTAMP(3),
    "capitalAmortizado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rendimentoAcumulado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "StatusContratoInvestimento" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contratos_investimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos_credito" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "pophubId" TEXT,
    "dataAssinatura" TIMESTAMP(3) NOT NULL,
    "dataPrimeiraParcela" TIMESTAMP(3) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "valorEntrada" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoDevedor" DECIMAL(12,2) NOT NULL,
    "numeroParcelas" INTEGER NOT NULL,
    "valorParcelaInicial" DECIMAL(12,2) NOT NULL,
    "periodicidade" "Periodicidade" NOT NULL DEFAULT 'SEMANAL',
    "indiceReajuste" TEXT,
    "taxaMultaAtraso" DECIMAL(5,2) NOT NULL DEFAULT 2.0,
    "taxaJurosAtraso" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "taxaDescontoQuitacao" DECIMAL(8,6),
    "status" "StatusContratoCredito" NOT NULL DEFAULT 'RASCUNHO',
    "dataEncerramento" TIMESTAMP(3),
    "motivoEncerramento" "MotivoEncerramento",
    "asaasSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contratos_credito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_contratados" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "natureza" "NaturezaProduto" NOT NULL,
    "origem" "OrigemItemContratado" NOT NULL DEFAULT 'VENDA',
    "acordoOrigemId" TEXT,
    "credor" "Credor" NOT NULL DEFAULT 'AZIT',
    "credorId" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "numeroParcelas" INTEGER,
    "periodicidade" "Periodicidade",
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3),
    "status" "StatusItemContratado" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "itens_contratados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcelas" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "itemContratadoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "totalParcelas" INTEGER NOT NULL,
    "display" TEXT NOT NULL,
    "valorNominal" DECIMAL(12,2) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "valorPago" DECIMAL(12,2),
    "valorEncargo" DECIMAL(12,2),
    "status" "StatusParcela",
    "faturaId" TEXT,
    "acordoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "parcelas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faturas" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "periodoReferencia" TIMESTAMP(3) NOT NULL,
    "dataFechamento" TIMESTAMP(3) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "valorTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorPago" DECIMAL(12,2),
    "status" "StatusFatura" NOT NULL DEFAULT 'ABERTA',
    "asaasChargeId" TEXT,
    "acordoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "faturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_fatura" (
    "id" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "parcelaId" TEXT NOT NULL,
    "tipo" "TipoItemFatura" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "credor" "Credor" NOT NULL DEFAULT 'AZIT',
    "credorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_fatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recebiveis" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "parcelaId" TEXT NOT NULL,
    "origemCapitalId" TEXT NOT NULL,
    "dataPrevista" TIMESTAMP(3) NOT NULL,
    "valorPrevisto" DECIMAL(12,2) NOT NULL,
    "dataRealizada" TIMESTAMP(3),
    "valorRealizado" DECIMAL(12,2),
    "status" "StatusRecebivel" NOT NULL DEFAULT 'ESPERADO',
    "breakdownCapital" DECIMAL(12,2),
    "breakdownRendimento" DECIMAL(12,2),
    "breakdownTaxaServico" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "recebiveis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acordos" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataEfetivacao" TIMESTAMP(3),
    "valorTotalRenegociado" DECIMAL(12,2) NOT NULL,
    "valorEntrada" DECIMAL(12,2) NOT NULL,
    "numeroParcelasNovas" INTEGER NOT NULL,
    "valorParcelaNova" DECIMAL(12,2) NOT NULL,
    "asaasChargeIdEntrada" TEXT,
    "status" "StatusAcordo" NOT NULL DEFAULT 'RASCUNHO',
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "acordos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reajustes_ipca" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "dataAniversario" TIMESTAMP(3) NOT NULL,
    "indiceAplicado" DECIMAL(8,4) NOT NULL,
    "valorParcelaAnterior" DECIMAL(12,2) NOT NULL,
    "valorParcelaNovo" DECIMAL(12,2) NOT NULL,
    "status" "StatusReajuste" NOT NULL DEFAULT 'PENDENTE',
    "aprovadoPor" TEXT,
    "dataAprovacao" TIMESTAMP(3),
    "dataAplicacao" TIMESTAMP(3),
    "dataNotificacaoCliente" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reajustes_ipca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_roles" (
    "usuarioId" TEXT NOT NULL,
    "role" "RoleUsuario" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_roles_pkey" PRIMARY KEY ("usuarioId","role")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "titulares_cpfCnpj_key" ON "titulares"("cpfCnpj");

-- CreateIndex
CREATE UNIQUE INDEX "titulares_asaasCustomerId_key" ON "titulares"("asaasCustomerId");

-- CreateIndex
CREATE INDEX "titulares_cpfCnpj_idx" ON "titulares"("cpfCnpj");

-- CreateIndex
CREATE INDEX "titulares_asaasCustomerId_idx" ON "titulares"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "intervenientes_garantidores_titularId_key" ON "intervenientes_garantidores"("titularId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_titularId_key" ON "contas"("titularId");

-- CreateIndex
CREATE UNIQUE INDEX "ativos_placa_key" ON "ativos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "ativos_chassi_key" ON "ativos"("chassi");

-- CreateIndex
CREATE INDEX "ativos_chassi_idx" ON "ativos"("chassi");

-- CreateIndex
CREATE INDEX "ativos_placa_idx" ON "ativos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "origens_capital_ativoId_key" ON "origens_capital"("ativoId");

-- CreateIndex
CREATE INDEX "origens_capital_contratoInvestimentoId_idx" ON "origens_capital"("contratoInvestimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_investimento_numero_key" ON "contratos_investimento"("numero");

-- CreateIndex
CREATE INDEX "contratos_investimento_contaId_idx" ON "contratos_investimento"("contaId");

-- CreateIndex
CREATE INDEX "contratos_investimento_modelo_idx" ON "contratos_investimento"("modelo");

-- CreateIndex
CREATE INDEX "contratos_investimento_status_idx" ON "contratos_investimento"("status");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_credito_numero_key" ON "contratos_credito"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_credito_ativoId_key" ON "contratos_credito"("ativoId");

-- CreateIndex
CREATE INDEX "contratos_credito_contaId_idx" ON "contratos_credito"("contaId");

-- CreateIndex
CREATE INDEX "contratos_credito_numero_idx" ON "contratos_credito"("numero");

-- CreateIndex
CREATE INDEX "contratos_credito_status_idx" ON "contratos_credito"("status");

-- CreateIndex
CREATE INDEX "contratos_credito_pophubId_idx" ON "contratos_credito"("pophubId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_contratados_acordoOrigemId_key" ON "itens_contratados"("acordoOrigemId");

-- CreateIndex
CREATE INDEX "itens_contratados_contratoId_idx" ON "itens_contratados"("contratoId");

-- CreateIndex
CREATE INDEX "itens_contratados_origem_idx" ON "itens_contratados"("origem");

-- CreateIndex
CREATE INDEX "parcelas_contratoId_idx" ON "parcelas"("contratoId");

-- CreateIndex
CREATE INDEX "parcelas_itemContratadoId_idx" ON "parcelas"("itemContratadoId");

-- CreateIndex
CREATE INDEX "parcelas_faturaId_idx" ON "parcelas"("faturaId");

-- CreateIndex
CREATE INDEX "parcelas_dataVencimento_idx" ON "parcelas"("dataVencimento");

-- CreateIndex
CREATE INDEX "parcelas_status_idx" ON "parcelas"("status");

-- CreateIndex
CREATE INDEX "faturas_contaId_idx" ON "faturas"("contaId");

-- CreateIndex
CREATE INDEX "faturas_status_idx" ON "faturas"("status");

-- CreateIndex
CREATE INDEX "faturas_dataVencimento_idx" ON "faturas"("dataVencimento");

-- CreateIndex
CREATE INDEX "faturas_asaasChargeId_idx" ON "faturas"("asaasChargeId");

-- CreateIndex
CREATE INDEX "itens_fatura_faturaId_idx" ON "itens_fatura"("faturaId");

-- CreateIndex
CREATE INDEX "itens_fatura_parcelaId_idx" ON "itens_fatura"("parcelaId");

-- CreateIndex
CREATE UNIQUE INDEX "recebiveis_parcelaId_key" ON "recebiveis"("parcelaId");

-- CreateIndex
CREATE INDEX "recebiveis_contratoId_idx" ON "recebiveis"("contratoId");

-- CreateIndex
CREATE INDEX "recebiveis_origemCapitalId_idx" ON "recebiveis"("origemCapitalId");

-- CreateIndex
CREATE INDEX "recebiveis_status_idx" ON "recebiveis"("status");

-- CreateIndex
CREATE INDEX "recebiveis_dataPrevista_idx" ON "recebiveis"("dataPrevista");

-- CreateIndex
CREATE INDEX "acordos_contratoId_idx" ON "acordos"("contratoId");

-- CreateIndex
CREATE INDEX "acordos_status_idx" ON "acordos"("status");

-- CreateIndex
CREATE INDEX "acordos_operadorId_idx" ON "acordos"("operadorId");

-- CreateIndex
CREATE INDEX "reajustes_ipca_contratoId_idx" ON "reajustes_ipca"("contratoId");

-- CreateIndex
CREATE INDEX "reajustes_ipca_status_idx" ON "reajustes_ipca"("status");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_email_idx" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_usuarioId_idx" ON "refresh_tokens"("usuarioId");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- AddForeignKey
ALTER TABLE "intervenientes_garantidores" ADD CONSTRAINT "intervenientes_garantidores_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas" ADD CONSTRAINT "contas_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "origens_capital" ADD CONSTRAINT "origens_capital_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "origens_capital" ADD CONSTRAINT "origens_capital_contratoInvestimentoId_fkey" FOREIGN KEY ("contratoInvestimentoId") REFERENCES "contratos_investimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_investimento" ADD CONSTRAINT "contratos_investimento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_credito" ADD CONSTRAINT "contratos_credito_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_credito" ADD CONSTRAINT "contratos_credito_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_contratados" ADD CONSTRAINT "itens_contratados_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_contratados" ADD CONSTRAINT "itens_contratados_acordoOrigemId_fkey" FOREIGN KEY ("acordoOrigemId") REFERENCES "acordos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_itemContratadoId_fkey" FOREIGN KEY ("itemContratadoId") REFERENCES "itens_contratados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "faturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_acordoId_fkey" FOREIGN KEY ("acordoId") REFERENCES "acordos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faturas" ADD CONSTRAINT "faturas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faturas" ADD CONSTRAINT "faturas_acordoId_fkey" FOREIGN KEY ("acordoId") REFERENCES "acordos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_fatura" ADD CONSTRAINT "itens_fatura_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "faturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_fatura" ADD CONSTRAINT "itens_fatura_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "parcelas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebiveis" ADD CONSTRAINT "recebiveis_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebiveis" ADD CONSTRAINT "recebiveis_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "parcelas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebiveis" ADD CONSTRAINT "recebiveis_origemCapitalId_fkey" FOREIGN KEY ("origemCapitalId") REFERENCES "origens_capital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acordos" ADD CONSTRAINT "acordos_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acordos" ADD CONSTRAINT "acordos_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reajustes_ipca" ADD CONSTRAINT "reajustes_ipca_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos_credito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
