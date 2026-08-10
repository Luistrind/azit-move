-- Correcao 09/08 (homologacao): a migration da Analise F1 criou o TIPO
-- 'analise_cadastro' mas NENHUMA celula de alcada — ninguem podia DECIDIR a
-- aprovacao do COCAD (so recomendar) e a proposta ficava no limbo.
-- DIRETOR e ADMIN decidem, sem teto (ajustavel na tela de Alcadas).
INSERT INTO "alcadas" ("id","papel","tipoOperacao","limiteMinimo","limiteMaximo","ilimitado","ativo","createdAt","updatedAt")
SELECT v.id, v.papel::"RoleUsuario", 'analise_cadastro', 0.00, 0.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('alc_cocad_dir','DIRETOR'), ('alc_cocad_adm','ADMIN')) AS v(id, papel)
WHERE NOT EXISTS (
  SELECT 1 FROM "alcadas" WHERE "tipoOperacao"='analise_cadastro' AND "papel"=v.papel::"RoleUsuario"
);
