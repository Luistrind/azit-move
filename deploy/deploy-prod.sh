#!/usr/bin/env bash
# Publica a PRODUÇÃO a partir de uma TAG de release (17/09). Nunca da main.
# Uso no servidor:   cd /opt/azit && git pull && bash deploy/deploy-prod.sh v1.0.0
#
# Faz: mostra o que muda  →  pede confirmação  →  BACKUP (banco + documentos)
#      →  build das imagens da tag (ou reaproveita se já existem)  →  atualiza
#      os serviços  →  migrações  →  checagem de saúde  →  registra a release.
#
# ROLLBACK = rodar este mesmo script com a tag anterior (a imagem já existe,
# é rápido). As migrações NÃO voltam — por isso a regra: migração só aditiva.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

TAG="${1:-}"
STACK="azit"
WT="$BUILD_ROOT/prod"
REGISTRO="$BACKUP_ROOT/releases.log"

if [ -z "$TAG" ]; then
  erro "Informe a tag:  bash deploy/deploy-prod.sh vX.Y.Z"
  echo "Tags disponíveis (mais recentes):"; git -C "$REPO_DIR" tag --sort=-creatordate | head -8
  exit 1
fi
git -C "$REPO_DIR" fetch --tags --prune origin >/dev/null
git -C "$REPO_DIR" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { erro "Tag $TAG não existe no repositório"; exit 1; }
carregar_env deploy/stack.env

etapa "O que vai para a PRODUÇÃO"
ANTERIOR=$(tail -1 "$REGISTRO" 2>/dev/null | awk '{print $3}' || true)
echo "Release atual:  ${ANTERIOR:-(nenhuma registrada — produção veio do fluxo antigo)}"
echo "Release nova:   $TAG ($(git -C "$REPO_DIR" rev-parse --short "$TAG^{commit}"))"
if [ -n "$ANTERIOR" ] && git -C "$REPO_DIR" rev-parse -q --verify "refs/tags/$ANTERIOR" >/dev/null; then
  echo; echo "Mudanças:"; git -C "$REPO_DIR" log --oneline --no-merges "$ANTERIOR..$TAG" | head -40
  MIGS=$(git -C "$REPO_DIR" diff --name-only "$ANTERIOR" "$TAG" -- apps/backend/prisma/migrations | grep migration.sql || true)
  echo; echo "Migrações novas:"; echo "${MIGS:-  (nenhuma)}"
fi

echo
read -r -p "Digite a tag ($TAG) para confirmar a publicação em PRODUÇÃO: " CONF
[ "$CONF" = "$TAG" ] || { erro "Confirmação não confere — nada foi feito."; exit 1; }

etapa "1/5 Backup antes da publicação"
bash deploy/backup.sh "$STACK" "pre-$TAG" || { erro "Backup falhou — publicação ABORTADA (nada mudou)."; exit 1; }

etapa "2/5 Imagens da release $TAG"
if docker image inspect "azit-backend:$TAG" >/dev/null 2>&1 && docker image inspect "azit-frontend:$TAG" >/dev/null 2>&1; then
  ok "Imagens de $TAG já existem (rollback/re-publicação) — build dispensado"
else
  preparar_worktree "$WT" "$TAG"
  trap 'remover_worktree "$WT"' EXIT
  docker build -t "azit-backend:$TAG" -f "$WT/apps/backend/Dockerfile" "$WT"
  docker build -t "azit-frontend:$TAG" \
    --build-arg VITE_API_URL=https://api.azitmove.com.br \
    --build-arg VITE_AMBIENTE=producao \
    -f "$WT/apps/frontend/Dockerfile" "$WT"
fi
# :latest acompanha a release publicada (o up.sh/stack usa :latest).
docker tag "azit-backend:$TAG" azit-backend:latest
docker tag "azit-frontend:$TAG" azit-frontend:latest

etapa "3/5 Atualizando os serviços"
docker service update --force --quiet --image "azit-backend:$TAG" "${STACK}_backend" >/dev/null
CID=$(aguardar_servico "${STACK}_backend")
ok "Backend $TAG no ar"

etapa "4/5 Migrações"
migrar "$CID"

docker service update --force --quiet --image "azit-frontend:$TAG" "${STACK}_frontend" >/dev/null
ok "Frontend $TAG no ar"

etapa "5/5 Saúde"
checar_saude https://api.azitmove.com.br/api/v1/health
checar_saude https://app.azitmove.com.br/

mkdir -p "$BACKUP_ROOT"
echo "$(date '+%Y-%m-%d %H:%M') $TAG $(git -C "$REPO_DIR" rev-parse --short "$TAG^{commit}")" >> "$REGISTRO"
echo
ok "PRODUÇÃO publicada na release $TAG → https://app.azitmove.com.br"
[ -n "$ANTERIOR" ] && echo "Rollback, se precisar:  bash deploy/deploy-prod.sh $ANTERIOR"
exit 0
