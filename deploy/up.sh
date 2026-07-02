#!/usr/bin/env bash
# Sobe/atualiza o stack do Azit no Swarm (lê os segredos de deploy/stack.env).
# Uso no servidor:  bash deploy/up.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f deploy/stack.env ]; then
  echo "ERRO: crie deploy/stack.env primeiro (copie de deploy/stack.env.example e preencha)."
  exit 1
fi

set -a; . deploy/stack.env; set +a
docker stack deploy -c deploy/azit-stack.swarm.yml azit
echo "==> Deploy disparado. Acompanhe com:  docker stack services azit"
echo "==> Log do backend:  docker service logs -f azit_backend"
