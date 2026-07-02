#!/usr/bin/env bash
# Diagnóstico do stack azit: por que o backend não autentica no Postgres.
set -uo pipefail
cd "$(dirname "$0")/.." || true

echo "===== SERVICES ====="
docker stack services azit

echo
echo "===== POSTGRES env (sem a senha) ====="
docker service inspect azit_postgres --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -vi password

echo
echo "===== POSTGRES: roles/usuários existentes ====="
CID=$(docker ps -qf name=azit_postgres | head -1)
if [ -n "${CID:-}" ]; then
  echo "-- tentando como azit --"
  docker exec "$CID" psql -U azit -d azit -tAc "select rolname from pg_roles order by 1" 2>&1 | head -20
  echo "-- tentando como postgres --"
  docker exec "$CID" psql -U postgres -tAc "select rolname from pg_roles order by 1" 2>&1 | head -20
else
  echo "(container do postgres não encontrado)"
fi

echo
echo "===== senha postgres vs backend ====="
PG=$(docker service inspect azit_postgres --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')
BE=$(docker service inspect azit_backend --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | sed -n 's#^DATABASE_URL=postgresql://azit:\(.*\)@postgres.*#\1#p')
echo "postgres: ${#PG} chars | backend: ${#BE} chars"
[ -n "$PG" ] && [ "$PG" = "$BE" ] && echo ">> IGUAIS" || echo ">> DIFERENTES"

echo
echo "===== BACKEND (últimas linhas) ====="
docker service logs azit_backend 2>&1 | tail -6
