#!/usr/bin/env bash
# Cria deploy/stack.env já com POSTGRES_PASSWORD, JWT_SECRET e ASAAS_WEBHOOK_SECRET
# gerados automaticamente. Você só precisa preencher a ASAAS_API_KEY depois.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f deploy/stack.env ]; then
  echo "deploy/stack.env já existe — não vou sobrescrever."
  echo "Se quiser editar:  nano deploy/stack.env"
  exit 0
fi

PG=$(openssl rand -hex 16)
JWT=$(openssl rand -hex 32)
WH=$(openssl rand -hex 16)

cat > deploy/stack.env <<EOF
POSTGRES_PASSWORD=$PG
JWT_SECRET=$JWT
ASAAS_API_KEY=COLE_AQUI_SUA_CHAVE_SANDBOX
ASAAS_WEBHOOK_SECRET=$WH
EOF

echo "=================================================================="
echo " deploy/stack.env criado com segredos gerados automaticamente."
echo ""
echo " >> ASAAS_WEBHOOK_SECRET (use EXATAMENTE este no painel do Asaas):"
echo "    $WH"
echo ""
echo " Falta 1 passo: colocar sua chave do sandbox do Asaas. Rode:"
echo "    nano deploy/stack.env"
echo " e troque  COLE_AQUI_SUA_CHAVE_SANDBOX  pela sua chave."
echo "=================================================================="
