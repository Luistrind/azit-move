#!/usr/bin/env bash
# Publica o SITE INSTITUCIONAL (azitmove.com.br e www) a partir de um ref do git.
# Uso no servidor:   cd /opt/azit && git fetch -q origin && bash deploy/deploy-site.sh origin/feat/site-institucional
#
# Página estática (apps/site) servida por nginx, num serviço próprio do Swarm,
# FORA dos stacks do sistema: publicar o site não reinicia o Hub, a API nem a
# fatura, e vice-versa. Pré-requisito: DNS de azitmove.com.br e www.azitmove.com.br
# apontando para este servidor (o certificado sai sozinho pelo Traefik).
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

REF="${1:-origin/main}"
SERVICO="azit-site"
WT="$BUILD_ROOT/site"

etapa "1/3 Código ($REF)"
preparar_worktree "$WT" "$REF"
trap 'remover_worktree "$WT"' EXIT
SHA=$(git -C "$WT" rev-parse --short HEAD)

etapa "2/3 Imagem azit-site:$SHA"
docker build -q -t "azit-site:$SHA" -f "$WT/apps/site/Dockerfile" "$WT" >/dev/null
docker tag "azit-site:$SHA" azit-site:latest
ok "Imagem pronta"

etapa "3/3 Serviço $SERVICO"
REGRA='Host(`azitmove.com.br`) || Host(`www.azitmove.com.br`)'
if docker service inspect "$SERVICO" >/dev/null 2>&1; then
  docker service update --quiet --image "azit-site:$SHA" "$SERVICO" >/dev/null
  ok "Serviço atualizado para $SHA"
else
  docker service create --quiet --name "$SERVICO" --network PopCarrosNet \
    --replicas 1 --restart-condition any \
    --label traefik.enable=true \
    --label traefik.docker.network=PopCarrosNet \
    --label traefik.http.routers.azit-site.entrypoints=websecure \
    --label "traefik.http.routers.azit-site.rule=$REGRA" \
    --label traefik.http.routers.azit-site.tls=true \
    --label traefik.http.routers.azit-site.tls.certresolver=letsencryptresolver \
    --label traefik.http.services.azit-site.loadbalancer.server.port=80 \
    "azit-site:$SHA" >/dev/null
  ok "Serviço criado"
fi

sleep 8
for h in azitmove.com.br www.azitmove.com.br; do
  # Testa pelo próprio Traefik (127.0.0.1): de dentro do servidor o IP público pode não voltar para ele mesmo.
  cod=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 --resolve "$h:443:127.0.0.1" "https://$h/" || true)
  case "$cod" in
    200|301) ok "https://$h/ respondeu $cod" ;;
    *) aviso "https://$h/ respondeu $cod — confira o DNS (registro A para este servidor). O certificado pode levar alguns minutos na primeira vez." ;;
  esac
done
ok "Site publicado ($SHA). Reverter: bash deploy/deploy-site.sh <ref anterior>"
