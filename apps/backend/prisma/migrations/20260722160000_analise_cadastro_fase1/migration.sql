-- Análise de Cadastro Fase 1 (Política v1.0 / Requisitos v0.2). Tudo aditivo.

-- Novos valores no enum de documentos da proposta
ALTER TYPE "TipoDocumentoProposta" ADD VALUE IF NOT EXISTS 'RG';
ALTER TYPE "TipoDocumentoProposta" ADD VALUE IF NOT EXISTS 'EXTRATO_BANCARIO';
ALTER TYPE "TipoDocumentoProposta" ADD VALUE IF NOT EXISTS 'EXTRATO_APLICATIVO';
ALTER TYPE "TipoDocumentoProposta" ADD VALUE IF NOT EXISTS 'MEI_CNPJ';
ALTER TYPE "TipoDocumentoProposta" ADD VALUE IF NOT EXISTS 'COMPROVANTE_ATIVIDADE';

-- Enums novos
CREATE TYPE "StatusAnalise" AS ENUM ('ATENDIMENTO_INICIADO','SIMULACAO_REALIZADA','CADASTRO_EM_PREENCHIMENTO','DOCUMENTOS_ENVIADOS','CONSULTA_INICIAL_REALIZADA','EM_TRIAGEM_INICIAL','PENDENTE_DE_COMPLEMENTO','EM_ANALISE_COMPLEMENTAR','SCORE_CONSULTADO','RESTRICOES_CONSULTADAS','PARECER_EMITIDO','APROVADO_ALCADA_ANALISTA','AGUARDANDO_COCAD','APROVADO_COCAD','APROVADO_COM_RESSALVAS','RESSALVA_EM_TRATAMENTO','PENDENTE_COMPLEMENTO_COCAD','LIBERADO_PARA_FORMALIZACAO','NAO_APROVADO','PROPOSTA_ENCERRADA');
CREATE TYPE "TipoConsultaExterna" AS ENUM ('CAMADA1','SCORE_QUOD','RESTRITIVOS');
CREATE TYPE "SituacaoConsulta" AS ENUM ('CONCLUIDA','FALHA');
CREATE TYPE "SituacaoPendencia" AS ENUM ('ABERTA','CUMPRIDA','EXPIRADA');
CREATE TYPE "TipoRessalva" AS ENUM ('AUMENTO_ENTRADA','REDUCAO_PROPOSTA','GARANTIDOR','DOCUMENTO_ADICIONAL','AJUSTE_CONDICAO');
CREATE TYPE "SituacaoRessalva" AS ENUM ('PENDENTE','CUMPRIDA','VALIDADA','EXPIRADA');
CREATE TYPE "NivelAlertaFraude" AS ENUM ('DUVIDA_DOCUMENTAL','INDICIO_RELEVANTE','INDICIO_CONFIRMADO','RESOLVIDO');
CREATE TYPE "MotivoEncerramentoAnalise" AS ENUM ('NAO_APROVACAO','DESISTENCIA','AUSENCIA_RETORNO','EXPIRACAO');

-- Tabelas
CREATE TABLE "versoes_parametros_analise" (
    "id" TEXT NOT NULL,
    "comprometimentoAlcada" DECIMAL(6,4) NOT NULL DEFAULT 0.40,
    "comprometimentoIntermediario" DECIMAL(6,4) NOT NULL DEFAULT 0.50,
    "scoreQuodMinimo" INTEGER NOT NULL DEFAULT 600,
    "restritivoNaoFinanceiroMax" DECIMAL(12,2) NOT NULL DEFAULT 500,
    "fatorSemanal" DECIMAL(8,4) NOT NULL DEFAULT 4.345,
    "fatorQuinzenal" DECIMAL(8,4) NOT NULL DEFAULT 2.17,
    "validadeConsultaDias" INTEGER NOT NULL DEFAULT 30,
    "validadeAprovacaoDiasUteis" INTEGER NOT NULL DEFAULT 10,
    "prazoComplementoDiasUteis" INTEGER NOT NULL DEFAULT 3,
    "prazoRessalvaDiasUteis" INTEGER NOT NULL DEFAULT 5,
    "validadeRessalvaDiasCorridos" INTEGER NOT NULL DEFAULT 7,
    "textoAutorizacao" TEXT NOT NULL DEFAULT 'Confirmo que o cliente autorizou a realizacao das consultas cadastrais necessarias a analise da proposta.',
    "versaoAutorizacao" INTEGER NOT NULL DEFAULT 1,
    "politicaVersao" TEXT NOT NULL DEFAULT '1.0',
    "criadoPor" TEXT,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "versoes_parametros_analise_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analises_cadastro" (
    "id" TEXT NOT NULL,
    "propostaId" TEXT NOT NULL,
    "parametroVersaoId" TEXT NOT NULL,
    "status" "StatusAnalise" NOT NULL DEFAULT 'ATENDIMENTO_INICIADO',
    "condutorPrincipalTitularId" TEXT,
    "parcelaMensalEquivalente" DECIMAL(12,2),
    "rendaApuradaTotal" DECIMAL(12,2),
    "comprometimento" DECIMAL(6,2),
    "aprovadaEm" TIMESTAMP(3),
    "aprovadaPor" TEXT,
    "liberadaEm" TIMESTAMP(3),
    "liberadaPor" TEXT,
    "encerradaEm" TIMESTAMP(3),
    "motivoEncerramento" "MotivoEncerramentoAnalise",
    "codigoNaoAprovacao" TEXT,
    "aprovacaoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "analises_cadastro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "analises_cadastro_propostaId_key" ON "analises_cadastro"("propostaId");
CREATE INDEX "analises_cadastro_status_idx" ON "analises_cadastro"("status");
ALTER TABLE "analises_cadastro" ADD CONSTRAINT "analises_cadastro_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "propostas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analises_cadastro" ADD CONSTRAINT "analises_cadastro_parametroVersaoId_fkey" FOREIGN KEY ("parametroVersaoId") REFERENCES "versoes_parametros_analise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "participantes_analise" (
    "id" TEXT NOT NULL,
    "analiseId" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "papel" "PapelTitular" NOT NULL,
    "rendaDeclarada" DECIMAL(12,2),
    "rendaPresumida" DECIMAL(12,2),
    "rendaApurada" DECIMAL(12,2),
    "rendaParcialmenteComprovada" BOOLEAN NOT NULL DEFAULT false,
    "identidadeValidada" BOOLEAN NOT NULL DEFAULT false,
    "cnhValida" BOOLEAN NOT NULL DEFAULT false,
    "documentoAlternativo" BOOLEAN NOT NULL DEFAULT false,
    "atividadeComprovada" BOOLEAN NOT NULL DEFAULT false,
    "evidenciaAtividade" TEXT,
    "processosRelevantes" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "participantes_analise_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "participantes_analise_analiseId_titularId_key" ON "participantes_analise"("analiseId","titularId");
ALTER TABLE "participantes_analise" ADD CONSTRAINT "participantes_analise_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "analises_cadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "participantes_analise" ADD CONSTRAINT "participantes_analise_titularId_fkey" FOREIGN KEY ("titularId") REFERENCES "titulares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "autorizacoes_consulta" (
    "id" TEXT NOT NULL,
    "analiseId" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "atendenteId" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "texto" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "versao" INTEGER NOT NULL,
    "evidenciaRef" TEXT,
    CONSTRAINT "autorizacoes_consulta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "autorizacoes_consulta_analiseId_titularId_key" ON "autorizacoes_consulta"("analiseId","titularId");
ALTER TABLE "autorizacoes_consulta" ADD CONSTRAINT "autorizacoes_consulta_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "analises_cadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "consultas_externas" (
    "id" TEXT NOT NULL,
    "analiseId" TEXT NOT NULL,
    "titularId" TEXT NOT NULL,
    "tipo" "TipoConsultaExterna" NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "protocolo" TEXT,
    "dataConsulta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "custo" DECIMAL(12,2),
    "situacao" "SituacaoConsulta" NOT NULL,
    "motivoFalha" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "resultado" JSONB,
    "registradaPor" TEXT,
    CONSTRAINT "consultas_externas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "consultas_externas_analiseId_titularId_tipo_idx" ON "consultas_externas"("analiseId","titularId","tipo");
ALTER TABLE "consultas_externas" ADD CONSTRAINT "consultas_externas_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "analises_cadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pendencias_analise" (
    "id" TEXT NOT NULL,
    "analiseId" TEXT NOT NULL,
    "titularId" TEXT,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "prazo" TIMESTAMP(3),
    "origemStatus" "StatusAnalise" NOT NULL,
    "situacao" "SituacaoPendencia" NOT NULL DEFAULT 'ABERTA',
    "resolvidaEm" TIMESTAMP(3),
    "resolvidaPor" TEXT,
    "criadaPor" TEXT,
    CONSTRAINT "pendencias_analise_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pendencias_analise_analiseId_situacao_idx" ON "pendencias_analise"("analiseId","situacao");
ALTER TABLE "pendencias_analise" ADD CONSTRAINT "pendencias_analise_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "analises_cadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ressalvas_analise" (
    "id" TEXT NOT NULL,
    "analiseId" TEXT NOT NULL,
    "tipo" "TipoRessalva" NOT NULL,
    "condicao" TEXT NOT NULL,
    "prazo" TIMESTAMP(3),
    "situacao" "SituacaoRessalva" NOT NULL DEFAULT 'PENDENTE',
    "evidenciaRef" TEXT,
    "cumpridaEm" TIMESTAMP(3),
    "validadaPor" TEXT,
    "validadaEm" TIMESTAMP(3),
    "criadaPor" TEXT,
    CONSTRAINT "ressalvas_analise_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ressalvas_analise_analiseId_situacao_idx" ON "ressalvas_analise"("analiseId","situacao");
ALTER TABLE "ressalvas_analise" ADD CONSTRAINT "ressalvas_analise_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "analises_cadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "alertas_fraude" (
    "id" TEXT NOT NULL,
    "analiseId" TEXT NOT NULL,
    "titularId" TEXT,
    "nivel" "NivelAlertaFraude" NOT NULL,
    "descricao" TEXT NOT NULL,
    "criadoPor" TEXT,
    "resolvidoPor" TEXT,
    "resolvidoEm" TIMESTAMP(3),
    CONSTRAINT "alertas_fraude_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "alertas_fraude_analiseId_idx" ON "alertas_fraude"("analiseId");
ALTER TABLE "alertas_fraude" ADD CONSTRAINT "alertas_fraude_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "analises_cadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "transicoes_analise" (
    "id" TEXT NOT NULL,
    "analiseId" TEXT NOT NULL,
    "de" "StatusAnalise",
    "para" "StatusAnalise" NOT NULL,
    "usuarioId" TEXT,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transicoes_analise_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transicoes_analise_analiseId_idx" ON "transicoes_analise"("analiseId");
ALTER TABLE "transicoes_analise" ADD CONSTRAINT "transicoes_analise_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "analises_cadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: versão 1 dos parâmetros da análise (valores da Política v1.0)
INSERT INTO "versoes_parametros_analise" ("id","criadoPor")
VALUES ('vpa_politica_v1_seed','seed-politica-v1');

-- Seed: operação de alçada do COCAD no motor de aprovação (2ª instância = 1 decisor além do parecer)
INSERT INTO "tipos_operacao_alcada" ("id","chave","nome","aprovacoesNecessarias","ativo","createdAt","updatedAt")
SELECT 'toa_analise_cadastro','analise_cadastro','Análise de cadastro (COCAD)',1,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "tipos_operacao_alcada" WHERE "chave"='analise_cadastro');
