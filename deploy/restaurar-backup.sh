#!/usr/bin/env bash
# RESTAURA um backup de banco sobre um ambiente. DESTRUTIVO: substitui TODO o
# banco atual do ambiente pelo conteúdo do arquivo.
# Uso:  bash deploy/restaurar-backup.sh azit /opt/azit-backups/azit/banco_XXXX.dump
#
# Regra LGPD (plano de ambientes): NUNCA restaure um backup da PRODUÇÃO no
# stack de homologação — o script recusa essa combinação.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"; ARQ="${2:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/restaurar-backup.sh azit|azit-hml <arquivo.dump>"; exit 1 ;; esac
[ -f "$ARQ" ] || { erro "Arquivo não encontrado: $ARQ"; exit 1; }
if [ "$STACK" = "azit-hml" ] && echo "$ARQ" | grep -q "/azit/"; then
  erro "Backup da PRODUÇÃO não pode ir para a homologação (dados pessoais reais)."; exit 1
fi

DBCID=$(container_do_servico "${STACK}_azit-db")
BECID=$(container_do_servico "${STACK}_backend")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }

aviso "Isto vai SUBSTITUIR todo o banco do ambiente '$STACK' pelo arquivo:"
echo "  $ARQ"
confirmar "RESTAURAR-$STACK" "Digite RESTAURAR-$STACK para confirmar: " || exit 1

etapa "Backup de segurança do estado atual"
bash deploy/backup.sh "$STACK" "antes-restauracao"

etapa "Restaurando"
[ -n "$BECID" ] && docker service scale "${STACK}_backend=0" >/dev/null
docker exec -i "$DBCID" pg_restore -U azit -d azit --clean --if-exists --no-owner < "$ARQ"
docker service scale "${STACK}_backend=1" >/dev/null
ok "Banco de $STACK restaurado de $(basename "$ARQ") — backend reiniciado"
