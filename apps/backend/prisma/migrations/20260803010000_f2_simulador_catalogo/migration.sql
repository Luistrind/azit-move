-- F2 — simulador consome o Catálogo (doc 02 §17, decisões 02-03/08). Aditivo.
ALTER TABLE "ativos" ADD COLUMN "varianteCatalogo" TEXT NOT NULL DEFAULT 'carro';
ALTER TABLE "ofertas" ADD COLUMN "foraParametro" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ofertas" ADD COLUMN "foraParametroMotivo" TEXT;
ALTER TABLE "propostas" ADD COLUMN "foraParametro" BOOLEAN NOT NULL DEFAULT false;

-- Tipo de operação de alçada: condição fora do parâmetro (decisão 03/08, opção b).
INSERT INTO "tipos_operacao_alcada" ("id","chave","nome","aprovacoesNecessarias","ativo","createdAt","updatedAt")
SELECT 'toa_condicao_fora_parametro','condicao_fora_parametro','Condição comercial fora do parâmetro',1,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "tipos_operacao_alcada" WHERE "chave"='condicao_fora_parametro');

-- Análise de cadastro adota os fatores do Catálogo (4,3452 / 2,1726) por NOVA
-- versão de parâmetros (decisão 02/08: "seguir o documento"). Sem recálculo do passado.
INSERT INTO "versoes_parametros_analise"
  ("id","comprometimentoAlcada","comprometimentoIntermediario","scoreQuodMinimo","restritivoNaoFinanceiroMax",
   "fatorSemanal","fatorQuinzenal","validadeConsultaDias","validadeAprovacaoDiasUteis","prazoComplementoDiasUteis",
   "prazoRessalvaDiasUteis","validadeRessalvaDiasCorridos","textoAutorizacao","versaoAutorizacao","politicaVersao",
   "criadoPor","vigenteDesde")
SELECT 'vpa_f2_fatores_catalogo',"comprometimentoAlcada","comprometimentoIntermediario","scoreQuodMinimo","restritivoNaoFinanceiroMax",
   4.3452,2.1726,"validadeConsultaDias","validadeAprovacaoDiasUteis","prazoComplementoDiasUteis",
   "prazoRessalvaDiasUteis","validadeRessalvaDiasCorridos","textoAutorizacao","versaoAutorizacao","politicaVersao",
   'migracao_f2',CURRENT_TIMESTAMP
FROM "versoes_parametros_analise"
WHERE NOT EXISTS (SELECT 1 FROM "versoes_parametros_analise" WHERE "id"='vpa_f2_fatores_catalogo')
ORDER BY "vigenteDesde" DESC
LIMIT 1;
