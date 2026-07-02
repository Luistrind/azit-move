#!/usr/bin/env bash
# Builda as imagens do Azit (backend + frontend) a partir da raiz do repo.
# Uso no servidor:  nohup bash deploy/build.sh > /opt/build.log 2>&1 &   (e:  tail -f /opt/build.log)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Build backend"
docker build -t azit-backend:latest -f apps/backend/Dockerfile .

echo "==> Build frontend (VITE_API_URL=https://api.azitmove.com.br)"
docker build -t azit-frontend:latest --build-arg VITE_API_URL=https://api.azitmove.com.br -f apps/frontend/Dockerfile .

echo "==> Imagens geradas:"
docker images | grep azit || true
echo "==> BUILD OK"
