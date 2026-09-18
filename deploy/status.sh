#!/usr/bin/env bash
# Panorama dos ambientes (17/09): o que está no homolog, o que está na produção
# e o que ainda não subiu. Somente leitura.
# Uso:  bash deploy/status.sh
set -uo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

git -C "$REPO_DIR" fetch --tags --prune origin >/dev/null 2>&1 || aviso "sem acesso ao GitHub agora — mostrando o que há local"

ULT_HML=$(tail -1 "$BACKUP_ROOT/homolog.log" 2>/dev/null || true)
ULT_PRD=$(tail -1 "$BACKUP_ROOT/releases.log" 2>/dev/null || true)
SHA_HML=$(echo "$ULT_HML" | awk '{print $4}')
REF_HML=$(echo "$ULT_HML" | awk '{print $3}')
TAG_PRD=$(echo "$ULT_PRD" | awk '{print $3}')

etapa "Ambientes"
printf '  %-12s %s\n' "HOMOLOG" "${ULT_HML:-(nada publicado ainda)}"
printf '  %-12s %s\n' "PRODUÇÃO" "${ULT_PRD:-(nenhuma release registrada)}"
echo
printf '  %-12s %s\n' "hml" "https://hml.azitmove.com.br"
printf '  %-12s %s\n' "produção" "https://app.azitmove.com.br"

if [ -n "${SHA_HML:-}" ] && [ -n "${TAG_PRD:-}" ] && git -C "$REPO_DIR" rev-parse -q --verify "refs/tags/$TAG_PRD" >/dev/null 2>&1; then
  etapa "No homolog e AINDA NÃO em produção"
  N=$(git -C "$REPO_DIR" log --oneline --no-merges "$TAG_PRD..$SHA_HML" 2>/dev/null | wc -l)
  if [ "$N" -eq 0 ]; then
    ok "Nada pendente — produção está com o mesmo código validado no homolog"
  else
    git -C "$REPO_DIR" log --oneline --no-merges "$TAG_PRD..$SHA_HML" | head -20
    MIG=$(git -C "$REPO_DIR" diff --name-only "$TAG_PRD" "$SHA_HML" -- apps/backend/prisma/migrations 2>/dev/null | grep -c migration.sql || true)
    echo; echo "  migrações novas nesse intervalo: ${MIG:-0}"
  fi
fi

etapa "Últimas releases publicadas"
tail -5 "$BACKUP_ROOT/releases.log" 2>/dev/null || echo "  (nenhuma)"

etapa "Backups recentes (produção)"
ls -lht "$BACKUP_ROOT/azit" 2>/dev/null | head -6 | awk 'NR>1{print "  "$9"  "$5"  "$6" "$7" "$8}' || echo "  (nenhum)"

etapa "Serviços"
docker stack services azit 2>/dev/null | head -6
docker stack services azit-hml 2>/dev/null | head -6
