#!/usr/bin/env bash
# Reseta o schema do banco (limpa estado sujo de migration parcial), reaplica TODAS
# as migrations do zero e roda o seed. Use quando o migrate deploy falhar com P2002.
# ATENÇÃO: apaga os dados do banco do Azit (ok num deploy novo, ainda sem dados reais).
set -euo pipefail
CID=$(docker ps -qf name=azit_backend | head -1)
if [ -z "${CID:-}" ]; then echo "Backend não está rodando (azit_backend)."; exit 1; fi

echo "===== Resetando schema + reaplicando migrations ====="
docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec prisma migrate reset --force --skip-seed"

echo
echo "===== Seed (admin + catálogos) ====="
docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec ts-node prisma/seed.ts"

echo
echo "==> Pronto. Login: admin@azit.com.br / azit123"
