-- Plano de categorias do financeiro (doc 02 §18.6, decisão Luís 05/10): as
-- naturezas NF01..NF99 viram as categorias do plano usado no Manda (grupo ->
-- categoria, mesmos códigos e nomes, buracos de numeração preservados).
-- Centro de custo passa a ser opcional no título.

CREATE TABLE "grupos_financeiros" (
  "id" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "grupos_financeiros_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "grupos_financeiros_codigo_key" ON "grupos_financeiros"("codigo");

ALTER TABLE "naturezas_financeiras" ADD COLUMN "grupoId" TEXT;
ALTER TABLE "naturezas_financeiras" ADD COLUMN "saida" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "naturezas_financeiras_grupoId_fkey"
  FOREIGN KEY ("grupoId") REFERENCES "grupos_financeiros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "titulos_pagar" ALTER COLUMN "centroCustoAreaId" DROP NOT NULL;

-- Grupos (os do Manda + um provisório para o que ainda não tem lugar no plano).
INSERT INTO "grupos_financeiros" ("id","codigo","nome","ordem","updatedAt") VALUES
 ('grpf_00','00','Lançamentos a identificar',0,CURRENT_TIMESTAMP),
 ('grpf_01','01','Receita Operacional Bruta',1,CURRENT_TIMESTAMP),
 ('grpf_02','02','Deduções da Receita',2,CURRENT_TIMESTAMP),
 ('grpf_03','03','Custos',3,CURRENT_TIMESTAMP),
 ('grpf_04','04','Despesas com Vendas',4,CURRENT_TIMESTAMP),
 ('grpf_05','05','Despesas gerais e administrativas',5,CURRENT_TIMESTAMP),
 ('grpf_06','06','Atividades de Investimento',6,CURRENT_TIMESTAMP),
 ('grpf_07','07','Atividades de Financiamento',7,CURRENT_TIMESTAMP),
 ('grpf_99','99','Fora do plano (provisório)',99,CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Naturezas existentes -> categorias do Manda (mesmo id: os títulos seguem apontando).
UPDATE "naturezas_financeiras" SET "codigo"='3.01', "nome"='Preparação de Veículos', "grupoId"='grpf_03' WHERE "codigo"='NF01';
UPDATE "naturezas_financeiras" SET "codigo"='3.03', "nome"='Detran (Impostos, Taxas e transferências)', "grupoId"='grpf_03' WHERE "codigo"='NF02';
UPDATE "naturezas_financeiras" SET "codigo"='6.02', "nome"='Aquisição de Veículos', "grupoId"='grpf_06' WHERE "codigo"='NF03';
UPDATE "naturezas_financeiras" SET "codigo"='5.13', "nome"='Sistemas contratados', "grupoId"='grpf_05' WHERE "codigo"='NF04';
UPDATE "naturezas_financeiras" SET "codigo"='5.14', "nome"='Serviços contratados', "grupoId"='grpf_05' WHERE "codigo"='NF05';
UPDATE "naturezas_financeiras" SET "codigo"='5.10', "nome"='Material de escritório', "grupoId"='grpf_05' WHERE "codigo"='NF06';
UPDATE "naturezas_financeiras" SET "codigo"='5.06', "nome"='Aluguel e condomínio', "grupoId"='grpf_05' WHERE "codigo"='NF07';
UPDATE "naturezas_financeiras" SET "codigo"='5.15', "nome"='Despesas diversas', "grupoId"='grpf_05' WHERE "codigo"='NF99';
-- Jurídico não existe no Manda: títulos vão para Serviços contratados; a natureza sai de uso.
UPDATE "titulos_pagar" SET "naturezaId" = (SELECT "id" FROM "naturezas_financeiras" WHERE "codigo"='5.14')
 WHERE "naturezaId" = (SELECT "id" FROM "naturezas_financeiras" WHERE "codigo"='NF08')
   AND EXISTS (SELECT 1 FROM "naturezas_financeiras" WHERE "codigo"='5.14');
UPDATE "naturezas_financeiras" SET "ativo"=false, "grupoId"='grpf_99', "nome"='Honorários e serviços jurídicos (antiga — use 5.14)' WHERE "codigo"='NF08';
-- Contrato recorrente e adiantamento não são "o que foi pago": saem de uso (o
-- adiantamento já é o prazo de prestação de contas do título).
UPDATE "naturezas_financeiras" SET "ativo"=false, "grupoId"='grpf_99' WHERE "codigo" IN ('NF09','NF10');
-- Desembolso do Reembolso Parcelado: ainda sem lugar no plano (decisão pendente, doc 02 §18.6).
UPDATE "naturezas_financeiras" SET "grupoId"='grpf_99' WHERE "codigo"='NF11';

-- Categorias do Manda que ainda não existiam.
INSERT INTO "naturezas_financeiras" ("id","codigo","nome","grupoId","saida","exigeAtivo","exigeCotacao","especial","exigeJustificativa","updatedAt") VALUES
 ('natf_0_02','0.02','Pagamentos a identificar','grpf_00',true,false,false,false,true,CURRENT_TIMESTAMP),
 ('natf_1_01','1.01','Vendas de Veículos','grpf_01',false,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_1_02','1.02','Receitas de Locação','grpf_01',false,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_2_01','2.01','PIS e COFINS','grpf_02',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_2_02','2.02','Devoluções/Descontos','grpf_02',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_3_02','3.02','Despachantes','grpf_03',true,true,false,false,false,CURRENT_TIMESTAMP),
 ('natf_3_05','3.05','Avaliações e Vistorias de Veículos','grpf_03',true,true,false,false,false,CURRENT_TIMESTAMP),
 ('natf_4_01','4.01','Marketing e Patrocínios','grpf_04',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_01','5.01','Remuneração de parceiros','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_02','5.02','Benefícios','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_11','5.11','Contabilidade','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_12','5.12','Telefonia e internet','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_16','5.16','Cartão de crédito','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_17','5.17','Taxas bancárias (TED, DOC, Boleto, PIX)','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_19','5.19','CSLL e IRPJ','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_20','5.20','Proteção Veicular','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_5_21','5.21','Capacitação de Parceiros','grpf_05',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_6_01','6.01','Equipamentos','grpf_06',true,false,true,false,false,CURRENT_TIMESTAMP),
 ('natf_7_02','7.02','Rendimentos','grpf_07',false,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_7_03','7.03','Despesas financeiras','grpf_07',true,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_7_05','7.05','Captação de empréstimos','grpf_07',false,false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_7_06','7.06','Amortização de empréstimos','grpf_07',true,false,false,false,false,CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
