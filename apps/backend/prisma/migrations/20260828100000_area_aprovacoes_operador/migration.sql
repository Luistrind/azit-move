-- Feedback 28/08 (caso real em producao): o OPERADOR solicita aprovacao (fora
-- do parametro, acordo, credito) e fica travado esperando — mas nao via a
-- Central nem o card da homepage porque a AREA Aprovacoes nao estava na matriz
-- do papel. Ver a central e seguro: a DECISAO continua protegida pela alcada
-- (papel x tipo x valor). FINANCEIRO idem (contas a pagar).
-- Idempotente e respeita edicoes manuais (ON CONFLICT DO NOTHING).
INSERT INTO "permissoes_papel_area" ("id","papel","area","permitido","updatedAt")
SELECT 'ppa_' || lower(v.papel) || '_' || lower(v.area), v.papel::"RoleUsuario", v.area::"AreaSistema", true, CURRENT_TIMESTAMP
FROM (VALUES
  ('OPERADOR','APROVACOES'),
  ('FINANCEIRO','APROVACOES')
) AS v(papel, area)
ON CONFLICT ("papel","area") DO NOTHING;
