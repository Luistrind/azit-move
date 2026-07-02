#!/usr/bin/env bash
# Mostra o estado das migrations e aplica-as no banco (dentro do container do backend).
set -uo pipefail
CID=$(docker ps -qf name=azit_backend | head -1)
if [ -z "${CID:-}" ]; then echo "Backend não está rodando (azit_backend)."; exit 1; fi

echo "===== migrate status ====="
docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec prisma migrate status" 2>&1 | tail -50

echo
echo "===== migrate deploy (aplicando) ====="
docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec prisma migrate deploy" 2>&1 | tail -50

echo
echo "===== tabelas em public ====="
docker exec "$CID" sh -lc "cd /app/apps/backend && echo \"select tablename from pg_tables where schemaname='public' order by 1;\" | pnpm exec prisma db execute --stdin" 2>&1 | tail -40 || true
