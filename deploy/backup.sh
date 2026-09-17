#!/usr/bin/env bash
# Backup de um ambiente: banco (pg_dump) + documentos anexados (volume de uploads).
# Uso:  bash deploy/backup.sh azit [motivo]        (produção)
#       bash deploy/backup.sh azit-hml [motivo]    (homologação)
# Destino: /opt/azit-backups/<stack>/  ·  diários guardados 7 dias, os de
# publicação (pre-vX.Y.Z) 30 dias.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"
MOTIVO="${2:-manual}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/backup.sh azit|azit-hml [motivo]"; exit 1 ;; esac

DESTINO="$BACKUP_ROOT/$STACK"
mkdir -p "$DESTINO"
chmod 700 "$BACKUP_ROOT" "$DESTINO"
CARIMBO="$(date '+%Y-%m-%d_%H%M')_${MOTIVO}"

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }

ARQ_DB="$DESTINO/banco_$CARIMBO.dump"
docker exec "$DBCID" pg_dump -U azit -d azit -Fc > "$ARQ_DB"
# Um dump válido tem conteúdo e é legível pelo pg_restore.
[ -s "$ARQ_DB" ] || { erro "Dump vazio"; rm -f "$ARQ_DB"; exit 1; }
docker exec -i "$DBCID" pg_restore --list < "$ARQ_DB" >/dev/null || { erro "Dump ilegível"; exit 1; }
ok "Banco:      $ARQ_DB ($(du -h "$ARQ_DB" | cut -f1))"

ARQ_UP="$DESTINO/documentos_$CARIMBO.tar.gz"
docker run --rm -v "${STACK}_azit_uploads:/dados:ro" -v "$DESTINO:/backup" alpine \
  tar czf "/backup/$(basename "$ARQ_UP")" -C /dados .
ok "Documentos: $ARQ_UP ($(du -h "$ARQ_UP" | cut -f1))"

# Retenção
find "$DESTINO" -type f -name '*_diario.*' -mtime +7 -delete
find "$DESTINO" -type f -name '*_pre-*' -mtime +30 -delete
ok "Backup de $STACK concluído"
