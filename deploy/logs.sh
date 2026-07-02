#!/usr/bin/env bash
# Mostra os logs do backend relevantes pro webhook/ativação.
echo "===== Webhook + ativação (filtrado) ====="
docker service logs azit_backend 2>&1 \
  | grep -aiE "webhooks/asaas|ativacao|conciliar|efetivar|assinatura_invalida|ativado|Cliente Asaas|Pacote ativado" \
  | tail -40
echo
echo "===== Últimas 15 linhas gerais do backend ====="
docker service logs azit_backend 2>&1 | tail -15
