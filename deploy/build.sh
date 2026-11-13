#!/usr/bin/env bash
# Builda as imagens do Azit (backend + frontend) a partir da raiz do repo.
# Uso no servidor:  nohup bash deploy/build.sh > /opt/build.log 2>&1 &   (e:  tail -f /opt/build.log)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Build backend"
docker build -t azit-backend:latest -f apps/backend/Dockerfile .

# VITE_GOOGLE_CLIENT_ID (doc 06 v1.1 §2.2): reserva de build time — a tela prefere
# GET /auth/config do backend. Lê de deploy/stack.env se existir.
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-$(grep -E '^GOOGLE_CLIENT_ID=' deploy/stack.env 2>/dev/null | cut -d= -f2- || true)}"
echo "==> Build frontend (VITE_API_URL=https://api.azitmove.com.br; VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:0:12}…)"
docker build -t azit-frontend:latest \
  --build-arg VITE_API_URL=https://api.azitmove.com.br \
  --build-arg VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
  -f apps/frontend/Dockerfile .

echo "==> Imagens geradas:"
docker images | grep azit || true
echo "==> BUILD OK"
