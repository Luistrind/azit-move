#!/usr/bin/env bash
# Publica a HOMOLOGAÇÃO a partir da branch main (17/09).
# Uso no servidor:   cd /opt/azit && git pull && bash deploy/deploy-hml.sh
# Opcional: outro ref (branch/tag/commit):  bash deploy/deploy-hml.sh minha-branch
#
# Faz: build das imagens :hml  →  sobe/atualiza o stack azit-hml  →  migrações
#      →  seed na primeira vez (banco vazio)  →  checagem de saúde.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

REF="${1:-origin/main}"
STACK="azit-hml"
WT="$BUILD_ROOT/hml"

carregar_env deploy/stack-hml.env || { erro "Rode antes: bash deploy/init-env-hml.sh"; exit 1; }

etapa "1/5 Código ($REF)"
preparar_worktree "$WT" "$REF"
trap 'remover_worktree "$WT"' EXIT

etapa "2/5 Build das imagens de homologação"
docker build -t azit-backend:hml -f "$WT/apps/backend/Dockerfile" "$WT"
docker build -t azit-frontend:hml \
  --build-arg VITE_API_URL=https://api-hml.azitmove.com.br \
  --build-arg VITE_AMBIENTE=homologacao \
  -f "$WT/apps/frontend/Dockerfile" "$WT"
ok "Imagens azit-backend:hml e azit-frontend:hml prontas"

etapa "3/5 Stack $STACK"
docker stack deploy -c "$WT/deploy/azit-hml-stack.swarm.yml" "$STACK"
# stack deploy não troca a imagem se o spec não mudou — força a versão nova.
if docker service inspect "${STACK}_backend" >/dev/null 2>&1; then
  docker service update --force --quiet --image azit-backend:hml "${STACK}_backend" >/dev/null
  docker service update --force --quiet --image azit-frontend:hml "${STACK}_frontend" >/dev/null
fi
CID=$(aguardar_servico "${STACK}_backend")
DBCID=$(aguardar_servico "${STACK}_azit-db")
ok "Backend e banco de homologação no ar"

etapa "4/5 Banco de homologação"
# O Postgres pode levar alguns segundos para aceitar conexões na 1ª subida.
for _ in $(seq 1 20); do
  docker exec "$DBCID" pg_isready -U azit -d azit >/dev/null 2>&1 && break
  sleep 3
done
migrar "$CID"
USUARIOS=$(docker exec "$DBCID" psql -U azit -d azit -tAc "select count(*) from usuarios" 2>/dev/null || echo 0)
if [ "${USUARIOS:-0}" = "0" ]; then
  aviso "Banco vazio — rodando seed de homologação (dados de teste + usuários)"
  docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec ts-node prisma/seed.ts"
  docker cp "$WT/apps/backend/scripts/criar-usuarios.ts" "$CID":/app/apps/backend/scripts/criar-usuarios.ts
  docker exec "$CID" sh -lc "cd /app/apps/backend && pnpm exec ts-node scripts/criar-usuarios.ts"
  ok "Seed concluído — logins de teste: admin@, diretor@, aprovador@, operador@, financeiro@azit.com.br (senha azit123)"
else
  ok "Banco já inicializado ($USUARIOS usuário(s)) — seed não é necessário"
fi

etapa "5/5 Saúde"
checar_saude https://api-hml.azitmove.com.br/api/v1/health || aviso "Se for a 1ª subida, o certificado pode levar 1–2 min (DNS precisa apontar para o servidor)."

echo
ok "HOMOLOGAÇÃO publicada ($(git -C "$REPO_DIR" rev-parse --short "$REF")) → https://hml.azitmove.com.br"
