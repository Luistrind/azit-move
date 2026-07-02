#!/usr/bin/env bash
# Dispara UMA vez o fechamento D-5 (fecha faturas vencendo + gera cobranças no Asaas),
# sem esperar o cron das 3h. Copia o script pro container do backend e o executa.
set -euo pipefail
cd "$(dirname "$0")/.."
CID=$(docker ps -qf name=azit_backend | head -1)
if [ -z "${CID:-}" ]; then echo "Backend (azit_backend) não está rodando."; exit 1; fi

docker cp apps/backend/scripts/fechar-once.ts "$CID":/app/apps/backend/scripts/fechar-once.ts
echo "== Rodando fechamento manual (mesmo código do cron) =="
docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec ts-node scripts/fechar-once.ts"
