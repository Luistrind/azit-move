#!/usr/bin/env bash
# Sobe/atualiza o stack do Azit no Swarm (lê os segredos de deploy/stack.env).
# Uso no servidor:  bash deploy/up.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f deploy/stack.env ]; then
  echo "ERRO: crie deploy/stack.env primeiro (bash deploy/init-env.sh e preencha a ASAAS_API_KEY)."
  exit 1
fi

# Carrega os segredos SEM expandir '$' nos valores. A chave do Asaas começa com '$'
# (ex.: $aact_...), então NÃO dá pra usar '. stack.env' (o shell tentaria expandir).
while IFS='=' read -r k v || [ -n "$k" ]; do
  case "$k" in ''|'#'*) continue ;; esac
  export "$k=$v"
done < deploy/stack.env

echo "==> ASAAS_API_KEY carregada no shell: ${ASAAS_API_KEY:0:12}...  (deve começar com \$aact_)"

docker stack deploy -c deploy/azit-stack.swarm.yml azit

echo "==> Conferindo a chave que foi para o serviço (mascarada):"
docker service inspect azit_backend --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' 2>/dev/null \
  | grep '^ASAAS_API_KEY=' | sed -E 's/(ASAAS_API_KEY=.{12}).*/\1.../'
echo "==> Deploy disparado. Acompanhe com:  docker stack services azit"
