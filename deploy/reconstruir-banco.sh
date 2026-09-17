#!/usr/bin/env bash
# Reconstrói o banco de um ambiente em um banco NOVO e limpo (17/09).
#
# POR QUÊ: o banco de produção tem o schema `public` recriado (OID 16392) e
# ~244 registros de catálogo apontando para o schema antigo (2200). Isso não
# atrapalha o sistema no dia a dia, mas QUEBRA o pg_dump inteiro — ou seja,
# hoje a produção não tem como ser copiada. Em vez de cirurgia no catálogo
# (arriscado), criamos um banco novo pelas MIGRAÇÕES e copiamos só o que deve
# ficar. Resolve o backup e faz a limpeza de dados pedida, de uma vez.
#
# O QUE FICA: usuários/permissões, alçadas, catálogo de produtos e versões de
# parâmetros, estruturas jurídicas, fundação do financeiro, parâmetros de
# assinatura e as credenciais de integração.
# O QUE SAI: todo o movimento (titulares, contas, contratos, parcelas, faturas,
# análises, acordos, novações, ativos, contas a pagar, notificações, trilhas).
#
# SEGURANÇA: o banco antigo NÃO é apagado — vira `azit_antigo_<data>` no mesmo
# servidor, e um backup físico é gerado antes de qualquer coisa. Para voltar,
# basta renomear de volta (o script mostra o comando no fim).
#
# Uso:  bash deploy/reconstruir-banco.sh azit      (ou azit-hml)
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-azit}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/reconstruir-banco.sh azit|azit-hml"; exit 1 ;; esac
CARIMBO="$(date '+%Y%m%d_%H%M')"
NOVO="azit_novo_$CARIMBO"
ANTIGO="azit_antigo_$CARIMBO"
DESTINO="$BACKUP_ROOT/$STACK"

# Ordem de dependência (pai antes do filho) — validada em ensaio 17/09.
PRESERVAR="usuarios usuario_roles permissoes_usuario_area permissoes_papel_area
tipos_operacao_alcada alcadas estruturas_juridicas produtos_catalogo
variantes_produto versoes_produto produtos versoes_parametros_simulacao
versoes_parametros_analise ofertas_fixas entidades_legais contas_bancarias
naturezas_financeiras centros_custo_areas parametros_assinatura parametros_integracao"

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
BECID=$(container_do_servico "${STACK}_backend")
[ -n "$BECID" ] || { erro "Backend do stack $STACK não está rodando (preciso dele para aplicar as migrações)"; exit 1; }
mkdir -p "$DESTINO"; chmod 700 "$BACKUP_ROOT" "$DESTINO"

etapa "Situação atual de $STACK"
docker exec "$DBCID" psql -U azit -d azit -tAc "
select 'schema public OID=' || (select oid from pg_namespace where nspname='public')
    || ' | registros de catálogo órfãos=' || (select count(*) from pg_class where relnamespace not in (select oid from pg_namespace))
    || ' | titulares=' || (select count(*) from titulares)
    || ' | contratos=' || (select count(*) from contratos_credito)
    || ' | faturas=' || (select count(*) from faturas)"
echo
aviso "Vai ser criado um banco NOVO e limpo; só parâmetros/catálogo/usuários são copiados."
aviso "O banco atual será RENOMEADO para $ANTIGO (nada é apagado)."
confirmar "RECONSTRUIR-$STACK" "Digite RECONSTRUIR-$STACK para continuar: " || exit 1

etapa "1/7 Backup físico (rede de segurança)"
ARQ_FIS="$DESTINO/fisico_${CARIMBO}_pre-reconstrucao.tar.gz"
docker exec "$DBCID" pg_basebackup -U azit -D - -Ft -X fetch -z > "$ARQ_FIS"
[ -s "$ARQ_FIS" ] || { erro "Backup físico vazio — ABORTADO"; exit 1; }
ok "Backup físico: $ARQ_FIS ($(du -h "$ARQ_FIS" | cut -f1))"

ARQ_UP="$DESTINO/documentos_${CARIMBO}_pre-reconstrucao.tar.gz"
docker run --rm -v "${STACK}_azit_uploads:/dados:ro" -v "$DESTINO:/backup" alpine \
  tar czf "/backup/$(basename "$ARQ_UP")" -C /dados . 2>/dev/null || true
ok "Documentos: $ARQ_UP ($(du -h "$ARQ_UP" 2>/dev/null | cut -f1 || echo 0))"

etapa "2/7 Banco novo + migrações"
docker exec "$DBCID" psql -U azit -d postgres -q -c "drop database if exists \"$NOVO\"" -c "create database \"$NOVO\""
SENHA=$(docker exec "$BECID" sh -lc 'echo "$DATABASE_URL"' | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')
docker exec -e DATABASE_URL="postgresql://azit:${SENHA}@azit-db:5432/${NOVO}?schema=public" "$BECID" \
  sh -lc "cd /app/apps/backend && pnpm exec prisma migrate deploy" 2>&1 | tail -4
TAB=$(docker exec "$DBCID" psql -U azit -d "$NOVO" -tAc "select count(*) from information_schema.tables where table_schema='public'")
[ "${TAB:-0}" -ge 60 ] || { erro "Banco novo ficou com apenas $TAB tabelas — ABORTADO (nada foi trocado)"; exit 1; }
ok "Banco novo com $TAB tabelas e catálogo limpo"

etapa "3/7 Copiando o que fica"
FALHAS=0
for t in $PRESERVAR; do
  if docker exec "$DBCID" sh -c "psql -U azit -d azit -qAtc \"\\copy (select * from $t) to stdout\" | psql -U azit -d $NOVO -qc \"\\copy $t from stdin\"" 2>/tmp/erro_copia; then
    O=$(docker exec "$DBCID" psql -U azit -d azit -tAc "select count(*) from $t")
    N=$(docker exec "$DBCID" psql -U azit -d "$NOVO" -tAc "select count(*) from $t")
    if [ "$O" = "$N" ]; then printf '  %-32s %s\n' "$t" "$N"; else erro "$t: origem=$O destino=$N"; FALHAS=1; fi
  else
    erro "$t: $(head -1 /tmp/erro_copia)"; FALHAS=1
  fi
done
[ "$FALHAS" -eq 0 ] || { erro "Cópia incompleta — ABORTADO. O banco em uso NÃO foi trocado (o novo ficou como $NOVO para inspeção)."; exit 1; }
ok "Tudo copiado e conferido"

etapa "4/7 Conferindo o banco novo"
docker exec "$DBCID" pg_dump -U azit -d "$NOVO" -Fc > /dev/null || { erro "pg_dump ainda falha no banco novo — ABORTADO"; exit 1; }
ok "pg_dump funciona no banco novo (problema resolvido)"

etapa "5/7 Trocando (backend para durante a troca)"
docker service scale "${STACK}_backend=0" >/dev/null
sleep 5
docker exec "$DBCID" psql -U azit -d postgres -q \
  -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('azit','$NOVO') and pid <> pg_backend_pid()" \
  -c "alter database azit rename to \"$ANTIGO\"" \
  -c "alter database \"$NOVO\" rename to azit"
docker service scale "${STACK}_backend=1" >/dev/null
CID=$(aguardar_servico "${STACK}_backend")
ok "Banco novo em uso; o anterior ficou como $ANTIGO"

etapa "6/7 Saúde"
if [ "$STACK" = "azit" ]; then checar_saude https://api.azitmove.com.br/api/v1/health; else checar_saude https://api-hml.azitmove.com.br/api/v1/health; fi

etapa "7/7 Primeiro backup lógico do banco novo"
bash deploy/backup.sh "$STACK" "pos-reconstrucao"

echo
ok "Reconstrução concluída."
echo "  Banco anterior preservado: $ANTIGO (nada foi apagado)"
echo "  Para voltar atrás (se precisar):"
echo "    docker service scale ${STACK}_backend=0"
echo "    docker exec $DBCID psql -U azit -d postgres -c \"alter database azit rename to ${NOVO}_descartado\" -c \"alter database \\\"$ANTIGO\\\" rename to azit\""
echo "    docker service scale ${STACK}_backend=1"
echo "  Quando tiver certeza de que está tudo certo, libere espaço com:"
echo "    docker exec $DBCID psql -U azit -d postgres -c 'drop database \"$ANTIGO\"'"
