#!/usr/bin/env bash
# Diagnóstico do stack azit: por que o backend não autentica no Postgres.
set -uo pipefail
cd "$(dirname "$0")/.." || true

echo "===== SERVICES ====="
docker stack services azit

echo
echo "===== POSTGRES: init do zero ou volume antigo? ====="
docker service logs azit_postgres 2>&1 | grep -iE "skipping|init process complete|ready to accept|database system is ready|does not exist|role|creating cluster" | tail -15

echo
echo "===== SENHA postgres vs backend (sem revelar o valor) ====="
PG=$(docker service inspect azit_postgres --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')
BE=$(docker service inspect azit_backend --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | sed -n 's#^DATABASE_URL=postgresql://azit:\(.*\)@postgres.*#\1#p')
echo "postgres: ${#PG} chars"
echo "backend : ${#BE} chars"
if [ -n "$PG" ] && [ "$PG" = "$BE" ]; then echo ">> SENHAS IGUAIS"; else echo ">> SENHAS DIFERENTES (ou vazias)"; fi

echo
echo "===== BACKEND (últimas linhas) ====="
docker service logs azit_backend 2>&1 | tail -8

echo
echo "===== VOLUMES azit ====="
docker volume ls | grep azit || true
