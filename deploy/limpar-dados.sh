#!/usr/bin/env bash
# Limpa os DADOS TRANSACIONAIS/DE TESTE do banco, preservando (decisão do Luís
# 2026-08-04, para iniciar a homologação):
#   - Usuários/sessão/permissões: usuarios, usuario_roles, refresh_tokens,
#     permissoes_papel_area, permissoes_usuario_area
#   - Catálogo: produtos_catalogo, variantes_produto, versoes_produto, produtos
#   - Parâmetros: versoes_parametros_simulacao, versoes_parametros_analise,
#     ofertas_fixas, tipos_operacao_alcada, alcadas
#   - Fundação do financeiro (seed/config, o desembolso do RP depende dela):
#     entidades_legais, contas_bancarias, naturezas_financeiras, centros_custo_areas
#   - Estruturas jurídicas (dona dos produtos/ativos — o catálogo aponta para ela)
#   - Parâmetros de assinatura e credenciais de integração (parametros_assinatura,
#     parametros_integracao) — configuração, não movimento
#   - Templates vivem no código (nada a preservar no banco). Chave do Asaas
#     vive no .env (NUNCA no banco) — não é tocada.
# Destrutivo e IRREVERSÍVEL. Resiliente: só apaga tabela que existir.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh
# Uso: bash deploy/limpar-dados.sh [azit|azit-hml]   (padrão: azit = PRODUÇÃO)
STACK="${1:-azit}"
case "$STACK" in azit|azit-hml) ;; *) erro "Stack inválido: $STACK"; exit 1 ;; esac
CID=$(container_do_servico "${STACK}_azit-db")
if [ -z "${CID:-}" ]; then erro "Container do banco (${STACK}_azit-db) não encontrado."; exit 1; fi
aviso "Isto APAGA todo o movimento (titulares, contratos, faturas, análises…) do ambiente '$STACK'."
confirmar "LIMPAR-$STACK" "Digite LIMPAR-$STACK para confirmar: " || exit 1
bash deploy/backup.sh "$STACK" "antes-limpeza"

docker exec -i "$CID" psql -U azit -d azit -v ON_ERROR_STOP=1 <<'SQL'
\echo '== ANTES =='
select 'usuarios' t, count(*) n from usuarios
  union all select 'alcadas', count(*) from alcadas
  union all select 'versoes_produto (catalogo)', count(*) from versoes_produto
  union all select 'estruturas_juridicas', count(*) from estruturas_juridicas
  union all select 'naturezas_financeiras', count(*) from naturezas_financeiras
  union all select 'titulares', count(*) from titulares
  union all select 'ativos', count(*) from ativos
  union all select 'contratos', count(*) from contratos_credito
  union all select 'faturas', count(*) from faturas
  union all select 'analises_cadastro', count(*) from analises_cadastro
  union all select 'titulos_pagar', count(*) from titulos_pagar
  union all select 'fornecedores_financeiro', count(*) from fornecedores_financeiro
  order by t;

\echo '== LIMPANDO dados transacionais (mantendo usuarios + parametros + catalogo + fundacao financeiro) =='
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    -- Funil comercial
    'leads','simulacoes','ofertas','propostas','itens_proposta','vinculos_papel',
    'documentos_proposta','pareceres',
    -- Analise de cadastro (movimento; versoes_parametros_analise FICA)
    'analises_cadastro','participantes_analise','autorizacoes_consulta',
    'consultas_externas','pendencias_analise','ressalvas_analise','alertas_fraude',
    'transicoes_analise','titular_classificacoes',
    -- Pessoas e capital
    'titulares','contas','investidores_estrutura',
    'contratos_investimento','origens_capital',
    -- 'estruturas_juridicas' NÃO entra (17/09): produtos_catalogo referencia a
    -- estrutura dona, e o TRUNCATE CASCADE levaria o CATÁLOGO INTEIRO junto
    -- (produtos + variantes + versões de parâmetros). Estrutura jurídica é
    -- parametrização — fica.
    -- Ativos (estoque de teste)
    'ativos','ativo_documentos','lancamentos_custo_ativo',
    -- Credito e carteira
    'contratos_credito','itens_contratados','parcelas','faturas','itens_fatura',
    'recebiveis','acordos','novacoes','reajustes_ipca',
    -- Notificações formais do POP-COB-001 (casos + prova; os PDFs ficam no
    -- volume de uploads/notificacoes). Parâmetros e textos FICAM.
    'casos_cobranca','notificacoes_cobranca',
    -- Conversas do WhatsApp (doc 02 sec.24; mídias em uploads/whatsapp)
    'mensagens_whatsapp',
    -- Motor de aprovacao (trilha transacional; tipos/alcadas FICAM)
    'aprovacoes','aprovacao_decisoes',
    -- Contas a pagar (movimento; entidades/contas bancarias/naturezas/centros FICAM)
    'fornecedores_financeiro','fornecedores_dados_bancarios',
    'solicitacoes_orcamento','orcamentos_fornecedor','titulos_pagar',
    'documentos_titulo','lotes_pagamento','pagamentos_titulo','conciliacoes_titulo',
    -- Lançamentos da conta (entradas de contrato/acordo materializadas)
    'lancamentos_conta','documentos_assinatura',
    -- Sino: notificações apontam para casos que deixam de existir
    'notificacoes','notificacoes_lidas',
    -- Trilhas
    'logs_auditoria'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;
END $$;

\echo '== DEPOIS (movimento zerado; usuarios/parametros/catalogo/fundacao intactos) =='
select 'usuarios' t, count(*) n from usuarios
  union all select 'alcadas', count(*) from alcadas
  union all select 'versoes_produto (catalogo)', count(*) from versoes_produto
  union all select 'estruturas_juridicas', count(*) from estruturas_juridicas
  union all select 'naturezas_financeiras', count(*) from naturezas_financeiras
  union all select 'titulares', count(*) from titulares
  union all select 'ativos', count(*) from ativos
  union all select 'contratos', count(*) from contratos_credito
  union all select 'faturas', count(*) from faturas
  union all select 'analises_cadastro', count(*) from analises_cadastro
  union all select 'titulos_pagar', count(*) from titulos_pagar
  union all select 'fornecedores_financeiro', count(*) from fornecedores_financeiro
  order by t;
SQL
echo "== Limpeza concluída =="
