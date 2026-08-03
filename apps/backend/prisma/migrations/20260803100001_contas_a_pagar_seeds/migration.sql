-- Contas a Pagar — seeds (separado da fundação: valor novo de enum não pode ser
-- usado na mesma transação em que foi criado).

-- Área nova na matriz papel×área: ADMIN, DIRETOR e FINANCEIRO recebem por padrão.
INSERT INTO "permissoes_papel_area" ("id","papel","area","permitido","updatedAt")
SELECT 'ppa_' || p || '_FINANCEIRO_ADMINISTRATIVO', p::"RoleUsuario", 'FINANCEIRO_ADMINISTRATIVO'::"AreaSistema", true, CURRENT_TIMESTAMP
FROM (VALUES ('ADMIN'),('DIRETOR'),('FINANCEIRO')) AS m(p)
ON CONFLICT DO NOTHING;

-- Entidades legais iniciais (unidades do Processo §4.1). CNPJs a preencher na implantação.
INSERT INTO "entidades_legais" ("id","razaoSocial","unidadeNegocio","updatedAt") VALUES
 ('entleg_azit','Azitmove','Azit Move',CURRENT_TIMESTAMP),
 ('entleg_rp','Reembolso Parcelado (entidade a constituir)','Reembolso Parcelado',CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Centros de custo organizacionais CC01–CC07 (Processo §4.2).
INSERT INTO "centros_custo_areas" ("id","codigo","nome","updatedAt") VALUES
 ('cca_cc01','CC01','Corporativo e Governança',CURRENT_TIMESTAMP),
 ('cca_cc02','CC02','Financeiro e Administrativo',CURRENT_TIMESTAMP),
 ('cca_cc03','CC03','Comercial e Marketing',CURRENT_TIMESTAMP),
 ('cca_cc04','CC04','Tecnologia e Dados',CURRENT_TIMESTAMP),
 ('cca_cc05','CC05','Operações e Frota',CURRENT_TIMESTAMP),
 ('cca_cc06','CC06','Crédito e Cobrança',CURRENT_TIMESTAMP),
 ('cca_cc07','CC07','Jurídico',CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Naturezas financeiras iniciais (Anexo C essencial — homologar com o BPO; editável).
INSERT INTO "naturezas_financeiras" ("id","codigo","nome","exigeAtivo","exigeCotacao","especial","exigeJustificativa","updatedAt") VALUES
 ('natf_manut','NF01','Preparação e manutenção de veículos',true,true,false,false,CURRENT_TIMESTAMP),
 ('natf_detran','NF02','Detran, tributos, multas e taxas públicas',true,false,false,false,CURRENT_TIMESTAMP),
 ('natf_aquisicao','NF03','Aquisição de veículos',true,false,true,false,CURRENT_TIMESTAMP),
 ('natf_sistemas','NF04','Sistemas e infraestrutura de tecnologia',false,true,true,false,CURRENT_TIMESTAMP),
 ('natf_servicos','NF05','Serviços de terceiros',false,true,false,false,CURRENT_TIMESTAMP),
 ('natf_materiais','NF06','Materiais e equipamentos',false,true,false,false,CURRENT_TIMESTAMP),
 ('natf_aluguel','NF07','Aluguel e condomínio',false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_juridico','NF08','Honorários e serviços jurídicos',false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_contrato_rec','NF09','Contratos recorrentes',false,false,true,false,CURRENT_TIMESTAMP),
 ('natf_adiantamento','NF10','Adiantamento',false,false,false,false,CURRENT_TIMESTAMP),
 ('natf_desemb_prod','NF11','Desembolso de produto (Reembolso Parcelado)',true,false,false,false,CURRENT_TIMESTAMP),
 ('natf_diversas','NF99','Despesas diversas',false,false,false,true,CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Tipos de aprovação do contas a pagar no motor de alçadas (RCPG011: eventos distintos).
INSERT INTO "tipos_operacao_alcada" ("id","chave","nome","aprovacoesNecessarias","ativo","createdAt","updatedAt")
SELECT v.id, v.chave, v.nome, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
 ('toa_orc_cp','orcamento_contas_pagar','Orçamento (contas a pagar)'),
 ('toa_desp_cp','despesa_contas_pagar','Despesa / título a pagar'),
 ('toa_lote_cp','lote_pagamento','Lote de pagamento'),
 ('toa_forn_cp','fornecedor_dados_bancarios','Fornecedor / dados bancários'),
 ('toa_reab_cp','reabertura_titulo','Reabertura de título')
) AS v(id,chave,nome)
WHERE NOT EXISTS (SELECT 1 FROM "tipos_operacao_alcada" t WHERE t."chave"=v.chave);

-- Alçadas seed (decisão 1 de 03/08: valores ANTERIORES 100/1.000, faixas com
-- mínimo e máximo POR TIPO; papel Gestor em aberto → Aprovador como placeholder).
INSERT INTO "alcadas" ("id","papel","tipoOperacao","limiteMinimo","limiteMaximo","ilimitado","ativo","createdAt","updatedAt")
SELECT v.id, v.papel::"RoleUsuario", v.tipo, v.minv, v.maxv, v.ilim, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
 -- Despesa: Financeiro até 100; Aprovador (placeholder do gestor) 100,01–1.000; Diretor acima.
 ('alc_desp_fin','FINANCEIRO','despesa_contas_pagar',0.00,100.00,false),
 ('alc_desp_apr','APROVADOR','despesa_contas_pagar',100.01,1000.00,false),
 ('alc_desp_dir','DIRETOR','despesa_contas_pagar',0.00,0.00,true),
 ('alc_desp_adm','ADMIN','despesa_contas_pagar',0.00,0.00,true),
 -- Orçamento: mesmas faixas.
 ('alc_orc_fin','FINANCEIRO','orcamento_contas_pagar',0.00,100.00,false),
 ('alc_orc_apr','APROVADOR','orcamento_contas_pagar',100.01,1000.00,false),
 ('alc_orc_dir','DIRETOR','orcamento_contas_pagar',0.00,0.00,true),
 ('alc_orc_adm','ADMIN','orcamento_contas_pagar',0.00,0.00,true),
 -- Lote e fornecedor bancário e reabertura: Diretor (RCPG008/018/034).
 ('alc_lote_dir','DIRETOR','lote_pagamento',0.00,0.00,true),
 ('alc_lote_adm','ADMIN','lote_pagamento',0.00,0.00,true),
 ('alc_forn_dir','DIRETOR','fornecedor_dados_bancarios',0.00,0.00,true),
 ('alc_forn_adm','ADMIN','fornecedor_dados_bancarios',0.00,0.00,true),
 ('alc_reab_dir','DIRETOR','reabertura_titulo',0.00,0.00,true),
 ('alc_reab_adm','ADMIN','reabertura_titulo',0.00,0.00,true)
) AS v(id,papel,tipo,minv,maxv,ilim)
WHERE NOT EXISTS (SELECT 1 FROM "alcadas" a WHERE a."papel"=v.papel::"RoleUsuario" AND a."tipoOperacao"=v.tipo);
