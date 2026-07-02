#!/usr/bin/env bash
# Rebuilda a imagem do backend e força o serviço a rodar a versão nova.
# (Só `docker stack deploy` não troca a imagem :latest se o spec não mudou — daí o --force.)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Rebuild backend =="
docker build -t azit-backend:latest -f apps/backend/Dockerfile /opt/azit

echo "== Atualizando o serviço com a imagem nova =="
docker service update --force --image azit-backend:latest azit_backend

echo "== OK. Log:  docker service logs -f azit_backend =="
