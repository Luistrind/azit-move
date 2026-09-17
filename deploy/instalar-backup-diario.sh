#!/usr/bin/env bash
# Agenda o backup DIÁRIO da produção (02:30, horário do servidor). Roda uma vez.
# Log: /var/log/azit-backup.log  ·  Para remover: rm /etc/cron.d/azit-backup
set -euo pipefail
cat > /etc/cron.d/azit-backup <<'EOF'
# Backup diário da PRODUÇÃO do Azit (banco + documentos) — deploy/backup.sh
30 2 * * * root /bin/bash /opt/azit/deploy/backup.sh azit diario >> /var/log/azit-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/azit-backup
echo "✔ Backup diário agendado (02:30). Teste agora com: bash /opt/azit/deploy/backup.sh azit teste"
