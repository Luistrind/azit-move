-- Catálogo de Produtos F1 (doc 02 §17). Aditivo. Produtos nascem em RASCUNHO:
-- o simulador atual segue sendo a fonte até a F2. Dinheiro em CENTAVOS no Json.
CREATE TYPE "CicloProduto" AS ENUM ('RASCUNHO','ATIVO','SUSPENSO','ENCERRADO');

CREATE TABLE "produtos_catalogo" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "finalidade" TEXT,
    "classificacao" TEXT,
    "status" "CicloProduto" NOT NULL DEFAULT 'RASCUNHO',
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "produtos_catalogo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "produtos_catalogo_chave_key" ON "produtos_catalogo"("chave");

CREATE TABLE "variantes_produto" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" "CicloProduto" NOT NULL DEFAULT 'RASCUNHO',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "variantes_produto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "variantes_produto_produtoId_chave_key" ON "variantes_produto"("produtoId","chave");
ALTER TABLE "variantes_produto" ADD CONSTRAINT "variantes_produto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "versoes_produto" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "varianteId" TEXT,
    "numero" INTEGER NOT NULL,
    "parametros" JSONB NOT NULL,
    "observacao" TEXT,
    "criadaPor" TEXT,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteAte" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "versoes_produto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "versoes_produto_produtoId_varianteId_idx" ON "versoes_produto"("produtoId","varianteId");
ALTER TABLE "versoes_produto" ADD CONSTRAINT "versoes_produto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "versoes_produto" ADD CONSTRAINT "versoes_produto_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "variantes_produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Seed: 3 produtos do Catálogo (valores das planilhas do Vicente)
-- ============================================================

INSERT INTO "produtos_catalogo" ("id","chave","nome","finalidade","classificacao","status","updatedAt") VALUES
 ('prodcat_cp','compra_parcelada','Compra Parcelada','Aquisição de bens do estoque','Principal','RASCUNHO',CURRENT_TIMESTAMP),
 ('prodcat_rp','reembolso_parcelado','Reembolso Parcelado','Pagamento parcelado de despesas elegíveis do veículo','Complementar','RASCUNHO',CURRENT_TIMESTAMP),
 ('prodcat_pv','protecao_veicular','Proteção Veicular','Proteção patrimonial do veículo e assistências conforme a oferta','Complementar','RASCUNHO',CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "variantes_produto" ("id","produtoId","chave","nome","status","ordem","updatedAt") VALUES
 ('varcp_carro','prodcat_cp','carro','Carro','RASCUNHO',1,CURRENT_TIMESTAMP),
 ('varcp_moto','prodcat_cp','moto','Moto','RASCUNHO',2,CURRENT_TIMESTAMP),
 ('varcp_outro','prodcat_cp','outro','Outro','RASCUNHO',3,CURRENT_TIMESTAMP),
 ('varpv_leves','prodcat_pv','leves','Leves','RASCUNHO',1,CURRENT_TIMESTAMP),
 ('varpv_duasrodas','prodcat_pv','duas_rodas','Duas Rodas','RASCUNHO',2,CURRENT_TIMESTAMP),
 ('varpv_utilitarios','prodcat_pv','utilitarios','Utilitários','RASCUNHO',3,CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Compra Parcelada — nível produto (versão 1)
INSERT INTO "versoes_produto" ("id","produtoId","varianteId","numero","parametros","observacao") VALUES
 ('vercp_prod_1','prodcat_cp',NULL,1,
  '{"atualizacaoMonetaria":"IPCA","multaMoratoria":0.02,"jurosMoraMensal":0.01,"meioPagamento":"PIX","prazoAtivacaoDias":5,"primeiroVencimentoMensalDias":59,"primeiroVencimentoQuinzenalDias":27,"primeiroVencimentoSemanalDias":13,"primeiroVencimentoDiariaDias":2,"baseMensalDias":30,"criterioElegibilidadeBem":"Disponível para venda"}',
  'Versão inicial — planilha Compra Parcelada (Vicente)')
ON CONFLICT DO NOTHING;

-- Compra Parcelada — variantes (versão 1). Centavos.
INSERT INTO "versoes_produto" ("id","produtoId","varianteId","numero","parametros","observacao") VALUES
 ('vercp_carro_1','prodcat_cp','varcp_carro',1,
  '{"entradaMinima":399000,"prazoMinimoMeses":12,"prazoMaximoMeses":60,"taxaRemuneracaoMensal":0.017,"comissaoInicial":399000,"comissaoRecorrenteMensal":79996,"taxaDescontoBemAntecipacao":0.016,"taxaDescontoComissaoAntecipacao":0,"isencaoComissaoLiquidacao":true,"protecaoObrigatoria":true,"protecaoMensal":22986,"taxaDescontoProtecaoAntecipacao":0,"isencaoProtecaoLiquidacao":true,"modeloContrato":"CNTC003","oferta1PrazoMeses":48,"oferta1Frequencia":"semanal","oferta1Entrada":399000,"oferta2PrazoMeses":36,"oferta2Frequencia":"quinzenal","oferta2Entrada":599000,"oferta3PrazoMeses":12,"oferta3Frequencia":"mensal","oferta3Entrada":999000}',
  'Versão inicial — planilha (variante Carro)'),
 ('vercp_moto_1','prodcat_cp','varcp_moto',1,
  '{"entradaMinima":99000,"prazoMinimoMeses":6,"prazoMaximoMeses":36,"taxaRemuneracaoMensal":0.03,"comissaoInicial":199000,"comissaoRecorrenteMensal":39996,"taxaDescontoBemAntecipacao":0.02,"taxaDescontoComissaoAntecipacao":0,"isencaoComissaoLiquidacao":true,"protecaoObrigatoria":true,"protecaoMensal":20490,"taxaDescontoProtecaoAntecipacao":0,"isencaoProtecaoLiquidacao":true,"modeloContrato":"CNTM001","oferta1PrazoMeses":24,"oferta1Frequencia":"semanal","oferta1Entrada":99000,"oferta2PrazoMeses":12,"oferta2Frequencia":"quinzenal","oferta2Entrada":299000,"oferta3PrazoMeses":6,"oferta3Frequencia":"mensal","oferta3Entrada":599000}',
  'Versão inicial — planilha (variante Moto)'),
 ('vercp_outro_1','prodcat_cp','varcp_outro',1,
  '{"entradaMinima":199000,"prazoMinimoMeses":6,"prazoMaximoMeses":48,"taxaRemuneracaoMensal":0.02,"comissaoInicial":299000,"comissaoRecorrenteMensal":39996,"taxaDescontoBemAntecipacao":0.018,"taxaDescontoComissaoAntecipacao":0,"isencaoComissaoLiquidacao":true,"protecaoObrigatoria":false,"protecaoMensal":0,"taxaDescontoProtecaoAntecipacao":0,"isencaoProtecaoLiquidacao":true,"modeloContrato":"CNTO001","oferta1PrazoMeses":36,"oferta1Frequencia":"semanal","oferta1Entrada":199000,"oferta2PrazoMeses":24,"oferta2Frequencia":"quinzenal","oferta2Entrada":399000,"oferta3PrazoMeses":6,"oferta3Frequencia":"mensal","oferta3Entrada":699000}',
  'Versão inicial — planilha (variante Outro)')
ON CONFLICT DO NOTHING;

-- Reembolso Parcelado — nível produto (sem variantes)
INSERT INTO "versoes_produto" ("id","produtoId","varianteId","numero","parametros","observacao") VALUES
 ('verrp_prod_1','prodcat_rp',NULL,1,
  '{"valorMinimoOperacao":30000,"valorMaximoOperacao":500000,"prazoMaximoMeses":12,"quantidadeMinimaParcelas":1,"valorMinimoParcela":5000,"encargoMensalProcessamento":0.1999,"taxaInicialProcessamento":0.0999,"taxaMinimaProcessamento":9990,"limiteParcelaAcessoria":0.3,"atualizacaoMonetaria":"Não aplicável","multaMoratoria":0.02,"jurosMoraMensal":0.01,"prazoAtivacaoDias":5,"primeiroVencimentoMensalDias":59,"primeiroVencimentoQuinzenalDias":27,"primeiroVencimentoSemanalDias":13,"primeiroVencimentoDiariaDias":2,"baseMensalDias":30,"cobranca":"Mesmo boleto/PIX do contrato principal","liquidacaoAntecipada":"Desconto proporcional dos encargos futuros","oferta1Valor":100000,"oferta1Parcelas":12,"oferta1Frequencia":"semanal","oferta2Valor":250000,"oferta2Parcelas":24,"oferta2Frequencia":"semanal","oferta3Valor":500000,"oferta3Parcelas":36,"oferta3Frequencia":"semanal"}',
  'Versão inicial — planilha Reembolso Parcelado (Vicente). Equivalência financeira: taxa do período = (1+taxa mensal)^(dias/30)−1')
ON CONFLICT DO NOTHING;

-- Proteção Veicular — nível produto + contribuição mínima por variante
-- Valores marcados como PROPOSTA PARA HOMOLOGAÇÃO (pergunta aberta 2 do doc de requisitos).
INSERT INTO "versoes_produto" ("id","produtoId","varianteId","numero","parametros","observacao") VALUES
 ('verpv_prod_1','prodcat_pv',NULL,1,
  '{"vigenciaPadraoMeses":12,"indiceReajuste":"IPCA, sujeito à revisão técnica anual","multaMoratoria":0.02,"jurosMoraMensal":0.01,"taxaAdministracaoMensal":2990,"baseMensalDias":30,"prazoAtivacaoDias":5,"ofertaEssencialTaxaFipe":0.0035,"ofertaEssencialAssistencia":0,"ofertaEssencialCobertura":"Roubo e furto","ofertaProtecaoTaxaFipe":0.005,"ofertaProtecaoAssistencia":1990,"ofertaProtecaoCobertura":"Roubo, furto e colisão","ofertaCompletaTaxaFipe":0.0065,"ofertaCompletaAssistencia":3990,"ofertaCompletaCobertura":"Coberturas ampliadas e assistência","statusValores":"Proposta para homologação","cancelamentoAntecipado":"Sem contribuições futuras"}',
  'Versão inicial — planilha Proteção Veicular (Vicente). Valores pendentes de homologação.'),
 ('verpv_leves_1','prodcat_pv','varpv_leves',1,'{"contribuicaoMinimaMensal":19996,"acrescimoMensalPerfil":0}','Versão inicial'),
 ('verpv_duasrodas_1','prodcat_pv','varpv_duasrodas',1,'{"contribuicaoMinimaMensal":9996,"acrescimoMensalPerfil":0}','Versão inicial'),
 ('verpv_utilitarios_1','prodcat_pv','varpv_utilitarios',1,'{"contribuicaoMinimaMensal":29996,"acrescimoMensalPerfil":0}','Versão inicial')
ON CONFLICT DO NOTHING;
