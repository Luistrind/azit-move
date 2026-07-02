#!/usr/bin/env bash
# Recria o banco do zero: remove o stack + o volume do Postgres e sobe de novo.
# Use se o Postgres estiver com senha antiga (volume reaproveitado). APAGA os dados do Azit.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Removendo stack azit..."
docker stack rm azit || true
echo "Aguardando encerrar (20s)..."
sleep 20
echo "Removendo volume do Postgres do Azit..."
docker volume rm azit_azit_pgdata 2>/dev/null || echo "(volume ainda em uso ou já removido — se falhar, espere 10s e rode de novo)"
echo "Subindo o stack de novo (init fresco do Postgres)..."
while IFS='=' read -r k v || [ -n "$k" ]; do
  case "$k" in ''|'#'*) continue ;; esac
  export "$k=$v"
done < deploy/stack.env
docker stack deploy -c deploy/azit-stack.swarm.yml azit
echo "OK. Aguarde ~40s e rode:  bash deploy/diag.sh"
