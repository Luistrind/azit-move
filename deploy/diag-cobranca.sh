#!/usr/bin/env bash
# Diagnóstico do pipeline de cobrança (fatura FECHADA → fila Redis → worker → Asaas).
# Rode no VPS: bash deploy/diag-cobranca.sh
# Lê apenas — não altera nada.
set -uo pipefail

RID=$(docker ps -qf name=azit_azit-redis | head -1)
PID=$(docker ps -qf name=azit_azit-db | head -1)
BID=$(docker ps -qf name=azit_backend | head -1)

echo "===== CONTAINERS ====="
echo "redis: ${RID:-NAO ENCONTRADO} | postgres: ${PID:-NAO ENCONTRADO} | backend: ${BID:-NAO ENCONTRADO}"

if [ -n "${RID:-}" ]; then
  echo
  echo "===== REDIS: uptime e persistência ====="
  docker exec "$RID" redis-cli INFO server | grep -E "uptime_in_days|redis_version"
  docker exec "$RID" redis-cli CONFIG GET appendonly
  docker exec "$RID" redis-cli CONFIG GET save
  echo "(uptime baixo = Redis reiniciou há pouco; sem appendonly/volume, restart = fila zerada)"

  echo
  echo "===== FILA gerar-cobranca-asaas: estado ====="
  for k in wait active delayed failed completed; do
    if [ "$k" = "wait" ] || [ "$k" = "active" ]; then
      N=$(docker exec "$RID" redis-cli LLEN "bull:gerar-cobranca-asaas:$k")
    else
      N=$(docker exec "$RID" redis-cli ZCARD "bull:gerar-cobranca-asaas:$k")
    fi
    echo "  $k: $N"
  done
  echo "  (failed>0 = jobs processaram e falharam — motivos abaixo;"
  echo "   tudo zerado inclusive completed = fila foi APAGADA em restart do Redis;"
  echo "   wait>0 parado = worker não está consumindo)"

  echo
  echo "===== FILA: motivos de falha (últimos 10) ====="
  for id in $(docker exec "$RID" redis-cli ZRANGE bull:gerar-cobranca-asaas:failed -10 -1); do
    DATA=$(docker exec "$RID" redis-cli HGET "bull:gerar-cobranca-asaas:$id" data)
    REASON=$(docker exec "$RID" redis-cli HGET "bull:gerar-cobranca-asaas:$id" failedReason)
    echo "  job $id | $DATA | $REASON"
  done

  echo
  echo "===== WORKERS conectados à fila ====="
  docker exec "$RID" redis-cli CLIENT LIST | grep -c "name=" | xargs echo "  conexões redis:"
fi

if [ -n "${PID:-}" ]; then
  echo
  echo "===== POSTGRES: faturas FECHADAS sem cobrança no Asaas ====="
  docker exec "$PID" psql -U azit -d azit -c "
    SELECT f.numero, t.nome AS titular, f.\"dataFechamento\"::date AS fechou,
           f.\"dataVencimento\"::date AS vence, f.\"valorTotal\", f.\"updatedAt\"::timestamp(0) AS fechada_em
    FROM faturas f
    JOIN contas c ON c.id = f.\"contaId\"
    JOIN titulares t ON t.id = c.\"titularId\"
    WHERE f.status = 'FECHADA' AND f.\"asaasChargeId\" IS NULL AND f.\"deletedAt\" IS NULL
    ORDER BY f.\"dataVencimento\";" 2>/dev/null \
  || docker exec "$PID" psql -U azit -d azit -c "SELECT numero, \"dataFechamento\"::date, \"dataVencimento\"::date, \"valorTotal\", \"updatedAt\" FROM faturas WHERE status='FECHADA' AND \"asaasChargeId\" IS NULL AND \"deletedAt\" IS NULL ORDER BY \"dataVencimento\";"
  echo "(a coluna fechada_em diz QUANDO o fechamento rodou — cruze com deploys/restarts)"
fi

if [ -n "${BID:-}" ]; then
  echo
  echo "===== BACKEND: logs de cobrança/fila/redis (últimos 7 dias) ====="
  docker logs --since 168h "$BID" 2>&1 | grep -iE "cobranc|bull|redis|ECONNREFUSED|fechar|cron" | tail -40
fi

echo
echo "===== FIM — cole esta saída inteira na conversa ====="
