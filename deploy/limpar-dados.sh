#!/usr/bin/env bash
# Limpa os DADOS TRANSACIONAIS/DE TESTE do banco, preservando:
#   - Usuários/sessão: usuarios, usuario_roles, refresh_tokens
#   - Configuração: alcadas, tipos_operacao_alcada, versoes_parametros_simulacao
#   - Catálogo: produtos, ofertas_fixas
# (Decisão do Luís 2026-07-05 — manter configuração.) Destrutivo e IRREVERSÍVEL.
# Resiliente: só apaga tabela que existir (independe da ordem de deploy).
set -euo pipefail
CID=$(docker ps -qf name=azit_azit-db | head -1)
if [ -z "${CID:-}" ]; then echo "Container do banco (azit_azit-db) não encontrado."; exit 1; fi

docker exec -i "$CID" psql -U azit -d azit -v ON_ERROR_STOP=1 <<'SQL'
\echo '== ANTES =='
select 'usuarios' t, count(*) n from usuarios
  union all select 'produtos', count(*) from produtos
  union all select 'alcadas', count(*) from alcadas
  union all select 'titulares', count(*) from titulares
  union all select 'ativos', count(*) from ativos
  union all select 'contratos', count(*) from contratos_credito
  union all select 'faturas', count(*) from faturas
  order by t;

\echo '== LIMPANDO dados transacionais (mantendo usuarios + config + catalogo) =='
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'acordos','aprovacao_decisoes','aprovacoes','ativos','contas','contratos_credito',
    'contratos_investimento','documentos_proposta','faturas','itens_contratados',
    'itens_fatura','itens_proposta','lancamentos_custo_ativo','leads','logs_auditoria',
    'novacoes','ofertas','origens_capital','parcelas','pareceres','propostas',
    'reajustes_ipca','recebiveis','simulacoes','titulares','vinculos_papel'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;
END $$;

\echo '== DEPOIS (dados zerados; usuarios/config/catalogo intactos) =='
select 'usuarios' t, count(*) n from usuarios
  union all select 'produtos', count(*) from produtos
  union all select 'alcadas', count(*) from alcadas
  union all select 'titulares', count(*) from titulares
  union all select 'ativos', count(*) from ativos
  union all select 'contratos', count(*) from contratos_credito
  union all select 'faturas', count(*) from faturas
  order by t;
SQL
echo "== Limpeza concluída =="
