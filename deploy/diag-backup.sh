#!/usr/bin/env bash
# Diagnóstico do backup (17/09) — SOMENTE LEITURA, não altera nada.
# Uso:  bash deploy/diag-backup.sh azit        (ou azit-hml)
# Serve para entender o erro "schema with OID 2200 does not exist" do pg_dump.
set -uo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh
STACK="${1:-azit}"

etapa "Containers do banco ($STACK)"
docker ps -a --filter "label=com.docker.swarm.service.name=${STACK}_azit-db" \
  --format 'table {{.ID}}\t{{.Status}}\t{{.CreatedAt}}' | head -10
echo "Tarefas do serviço:"
docker service ps "${STACK}_azit-db" --no-trunc --format 'table {{.ID}}\t{{.CurrentState}}\t{{.Error}}' 2>/dev/null | head -6

CID=$(container_do_servico "${STACK}_azit-db")
[ -n "$CID" ] || { erro "Nenhum container do banco rodando"; exit 1; }
echo "Container em uso: $CID"
echo "Volume:"; docker inspect "$CID" --format '{{range .Mounts}}{{.Name}} → {{.Destination}}{{println}}{{end}}'

etapa "Versões"
docker exec "$CID" psql -U azit -d azit -tAc "select 'servidor: ' || version()" 2>&1 | head -1
docker exec "$CID" sh -lc 'echo "pg_dump: $(pg_dump --version)"'

etapa "Conteúdo (confirma que é o banco certo)"
docker exec "$CID" psql -U azit -d azit -tAc "
select 'banco=' || current_database()
    || ' | tabelas public=' || (select count(*) from information_schema.tables where table_schema='public')
    || ' | titulares=' || (select count(*) from titulares)
    || ' | contratos=' || (select count(*) from contratos_credito)" 2>&1 | head -2

etapa "Schemas e referências órfãs a schema"
docker exec "$CID" psql -U azit -d azit -c "select oid, nspname, nspowner::regrole::text as dono from pg_namespace order by oid" 2>&1 | head -15
docker exec "$CID" psql -U azit -d azit -c "
with refs as (
  select 'pg_class'        as catalogo, relnamespace   as ns from pg_class
  union all select 'pg_type',        typnamespace       from pg_type
  union all select 'pg_proc',        pronamespace       from pg_proc
  union all select 'pg_extension',   extnamespace       from pg_extension
  union all select 'pg_default_acl', defaclnamespace    from pg_default_acl
  union all select 'pg_conversion',  connamespace       from pg_conversion
  union all select 'pg_operator',    oprnamespace       from pg_operator
  union all select 'pg_opclass',     opcnamespace       from pg_opclass
  union all select 'pg_collation',   collnamespace      from pg_collation
  union all select 'pg_statistic_ext', stxnamespace     from pg_statistic_ext
)
select catalogo, ns as schema_oid, count(*) as ocorrencias
from refs where ns is not null and ns not in (select oid from pg_namespace)
group by 1,2 order by 1" 2>&1 | head -15

etapa "Testes de dump (nada é gravado)"
echo -n "dump só do schema (-s): "; docker exec "$CID" pg_dump -U azit -d azit -s > /dev/null 2>/tmp/e1 && echo OK || { echo FALHOU; head -2 /tmp/e1; }
echo -n "dump completo (-Fc):    "; docker exec "$CID" pg_dump -U azit -d azit -Fc > /dev/null 2>/tmp/e2 && echo OK || { echo FALHOU; head -2 /tmp/e2; }
echo -n "dump só dados (-a):     "; docker exec "$CID" pg_dump -U azit -d azit -a > /dev/null 2>/tmp/e3 && echo OK || { echo FALHOU; head -2 /tmp/e3; }
echo -n "pg_dumpall (--globals): "; docker exec "$CID" pg_dumpall -U azit --globals-only > /dev/null 2>/tmp/e4 && echo OK || { echo FALHOU; head -2 /tmp/e4; }

etapa "Fim — mande esta saída inteira"
