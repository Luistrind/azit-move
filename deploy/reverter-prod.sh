#!/usr/bin/env bash
# Volta a PRODUÇÃO para a release anterior (17/09). Uso:  bash deploy/reverter-prod.sh
# Opcional, para escolher outra:  bash deploy/reverter-prod.sh v1.0.3
#
# O CÓDIGO volta na hora (as imagens de cada release ficam guardadas). O BANCO
# não volta sozinho: migrações são aditivas de propósito, então o código antigo
# roda sobre o banco novo sem quebrar. Se a publicação estragou DADOS, o
# caminho é restaurar o backup pré-publicação (o script mostra qual é).
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

REGISTRO="$BACKUP_ROOT/releases.log"
[ -s "$REGISTRO" ] || { erro "Nenhuma release registrada em $REGISTRO — nada a reverter."; exit 1; }

ATUAL=$(tail -1 "$REGISTRO" | awk '{print $3}')
ALVO="${1:-$(tail -2 "$REGISTRO" | head -1 | awk '{print $3}')}"

if [ "$ALVO" = "$ATUAL" ]; then
  erro "A release anterior é a mesma que está no ar ($ATUAL). Informe a tag desejada:"
  echo "Releases publicadas (mais recentes por último):"; tail -8 "$REGISTRO"
  exit 1
fi

etapa "Reversão da produção"
echo "  Está no ar:        $ATUAL"
echo "  Vai voltar para:   $ALVO"
echo
echo "  O que sai do ar (commits de $ALVO até $ATUAL):"
git -C "$REPO_DIR" log --oneline --no-merges "$ALVO..$ATUAL" 2>/dev/null | head -20 || true
MIG=$(git -C "$REPO_DIR" diff --name-only "$ALVO" "$ATUAL" -- apps/backend/prisma/migrations 2>/dev/null | grep migration.sql || true)
if [ -n "$MIG" ]; then
  echo
  aviso "Estas migrações JÁ foram aplicadas e NÃO voltam (o código antigo convive com elas):"
  echo "$MIG" | sed 's/^/    /'
fi
BKP=$(ls -t "$BACKUP_ROOT/azit"/banco_*_pre-"$ATUAL".dump 2>/dev/null | head -1 || true)
[ -n "$BKP" ] && echo && echo "  Backup feito antes da publicação atual: $BKP"

echo
confirmar "$ALVO" "Digite a tag de destino ($ALVO) para reverter a PRODUÇÃO: " || exit 1

REVERSAO_CONFIRMADA=1 bash deploy/deploy-prod.sh "$ALVO"
