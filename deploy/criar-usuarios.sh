#!/usr/bin/env bash
# Cria/atualiza SÓ os usuários internos (idempotente, não apaga dados). Senha: azit123.
# Use se os usuários aprovador@/diretor@/etc. não existirem no banco.
set -euo pipefail
cd "$(dirname "$0")/.."
CID=$(docker ps -qf name=azit_backend | head -1)
if [ -z "${CID:-}" ]; then echo "Backend (azit_backend) não está rodando."; exit 1; fi

docker cp apps/backend/scripts/criar-usuarios.ts "$CID":/app/apps/backend/scripts/criar-usuarios.ts
echo "== Criando/atualizando usuários (senha azit123) =="
docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec ts-node scripts/criar-usuarios.ts"
