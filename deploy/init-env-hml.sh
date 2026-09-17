#!/usr/bin/env bash
# Cria deploy/stack-hml.env (segredos da HOMOLOGAÇÃO) — roda UMA vez.
# Gera senha do banco, JWT e segredo de webhook NOVOS (nunca os da produção)
# e reaproveita a chave SANDBOX do Asaas da produção enquanto ela for sandbox.
set -euo pipefail
cd "$(dirname "$0")/.."

ARQ=deploy/stack-hml.env
if [ -f "$ARQ" ]; then
  echo "$ARQ já existe — não vou sobrescrever (edite com: nano $ARQ)."
  exit 0
fi

ASAAS_KEY=""
if [ -f deploy/stack.env ]; then
  URL_PROD=$(grep -E '^ASAAS_API_URL=' deploy/stack.env | cut -d= -f2- || true)
  if [ -z "$URL_PROD" ] || echo "$URL_PROD" | grep -q sandbox; then
    ASAAS_KEY=$(grep -E '^ASAAS_API_KEY=' deploy/stack.env | cut -d= -f2- || true)
  fi
fi

WH=$(openssl rand -hex 24)
cat > "$ARQ" <<EOF
# Segredos da HOMOLOGAÇÃO (stack azit-hml). NÃO versionar.
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
# Chave do SANDBOX do Asaas (homologação nunca usa a chave de produção).
ASAAS_API_KEY=$ASAAS_KEY
ASAAS_WEBHOOK_SECRET=$WH
# Opcionais — vazios = provedores simulados (não consomem créditos).
BIGDATACORP_TOKEN_ID=
BIGDATACORP_ACCESS_TOKEN=
ZAPSIGN_API_TOKEN=
ZAPSIGN_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
EOF
chmod 600 "$ARQ"

echo "=================================================================="
echo " $ARQ criado."
if [ -n "$ASAAS_KEY" ]; then
  echo " Chave sandbox do Asaas reaproveitada da produção (ela ainda é sandbox)."
else
  echo " ATENÇÃO: nenhuma chave sandbox encontrada — o Asaas do homolog fica"
  echo " SIMULADO até você cadastrar a chave em Configurações > Integrações."
fi
echo ""
echo " No painel SANDBOX do Asaas, adicione um SEGUNDO webhook:"
echo "   URL:   https://api-hml.azitmove.com.br/api/v1/webhooks/asaas"
echo "   Token: $WH"
echo "   Eventos: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE"
echo "=================================================================="
