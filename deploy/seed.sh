#!/usr/bin/env bash
# Roda o seed dentro do container do backend (cria admin@azit.com.br + catálogos).
set -euo pipefail
CID=$(docker ps -qf name=azit_backend | head -1)
if [ -z "${CID:-}" ]; then
  echo "Backend não está rodando (azit_backend). Rode 'bash deploy/diag.sh' antes."
  exit 1
fi
echo "Rodando seed no container $CID ..."
docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec ts-node prisma/seed.ts"
echo "==> Seed concluído. Login: admin@azit.com.br"
