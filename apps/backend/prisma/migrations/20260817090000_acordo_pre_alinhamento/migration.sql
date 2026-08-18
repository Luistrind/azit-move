-- Pacote pré-alinhamento do Acordo de Pagamento (doc Vicente V1.0, 16/08):
-- (a) F0 — produto no Catálogo em RASCUNHO com parâmetros AP001–AP027 versionados;
-- (b) snapshot da proposta no Acordo (seleção por fatura + justificativas — RAP005/006/034).

-- (a) Produto Acordo de Pagamento — NASCE EM RASCUNHO (não muda comportamento).
INSERT INTO "produtos_catalogo" ("id","chave","nome","finalidade","classificacao","status","updatedAt") VALUES
 ('prodcat_ap','acordo_pagamento','Acordo de Pagamento','Regularização de faturas vencidas, sem novação do contrato original','Complementar','RASCUNHO',CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Versão 1 (nível produto) — parâmetros do doc V1.0 (dinheiro em CENTAVOS; percentual em fração).
-- ATENÇÃO doc: AP028 é citado nos gatilhos mas não existe na tabela de parâmetros (inconsistência
-- sinalizada ao Vicente); adotado prazoMaximoPadraoMeses=6 (AP007) e prazoTetoExcecaoMeses=12 (§9.3).
INSERT INTO "versoes_produto" ("id","produtoId","varianteId","numero","parametros","observacao") VALUES
 ('verap_prod_1','prodcat_ap',NULL,1,
  '{"diasMinimosAtrasoElegibilidade":15,"maxAcordosAtivosSimultaneos":2,"percentualEntradaMinima":0.30,"quantidadeMinimaParcelas":1,"prazoMaximoPadraoMeses":6,"prazoTetoExcecaoMeses":12,"valorMinimoParcela":5000,"descontoPadrao":0,"limiteDescontoOperador":0,"taxaInicialProcessamento":0.0999,"encargoMensalProcessamento":0.0499,"frequencia":"Herdada do contrato principal","prazoAtivacaoDias":5,"meioPagamentoEntrada":"Cobrança avulsa PIX/boleto","meioPagamentoParcelas":"Fatura do contrato principal","baseMensalDias":30,"liquidacaoAntecipada":"Desconto proporcional dos encargos futuros","multaMoratoria":0.02,"jurosMoraMensal":0.01,"primeiroVencimentoMensalDias":59,"primeiroVencimentoQuinzenalDias":27,"primeiroVencimentoSemanalDias":13,"primeiroVencimentoDiariaDias":2,"ajusteResidual":"Última parcela"}',
  'Versão inicial — Produto Acordo de Pagamento V1.0 (Vicente, 16/08/2026). Pendências §19 em alinhamento; produto permanece em RASCUNHO até homologação.')
ON CONFLICT DO NOTHING;

-- (b) Snapshot da proposta de acordo (fotografia RAP034: faturas selecionadas,
-- exclusões justificadas, saldos na data-base).
ALTER TABLE "acordos" ADD COLUMN IF NOT EXISTS "snapshotJson" JSONB;
