#!/usr/bin/env bash
# Rebuilda a imagem do frontend e força o serviço a rodar a versão nova.
# VITE_API_URL é lido em BUILD TIME (Vite inlina no bundle).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Rebuild frontend (VITE_API_URL=https://api.azitmove.com.br) =="
docker build -t azit-frontend:latest \
  --build-arg VITE_API_URL=https://api.azitmove.com.br \
  -f apps/frontend/Dockerfile /opt/azit

echo "== Atualizando o serviço com a imagem nova =="
docker service update --force --image azit-frontend:latest azit_frontend

echo "== OK. Log:  docker service logs -f azit_frontend =="
