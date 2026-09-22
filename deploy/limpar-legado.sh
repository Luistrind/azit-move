#!/usr/bin/env bash
# Descarta TUDO da bancada de migração do legado (doc 02 §26) — e só isso.
#
# A bancada vive em três tabelas próprias, sem chave estrangeira para o resto
# do sistema: casos_migracao_legado, cobrancas_legadas e coletas_legado, mais
# os PDFs em uploads/legado. Apagar isso NÃO toca titular, conta, contrato,
# fatura ou parcela. É o que permite validar a F1/F2 na PRODUÇÃO lendo a
# conta real do Asaas (decisão Luís 21/09) e jogar fora quando quiser.
#
# Uso (no servidor, como root):  bash deploy/limpar-legado.sh azit      (ou azit-hml)
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/limpar-legado.sh azit|azit-hml"; exit 1 ;; esac

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
BECID=$(container_do_servico "${STACK}_backend")

etapa "Bancada do legado em $STACK"
docker exec "$DBCID" psql -U azit -d azit -tAc "
  select 'casos=' || (select count(*) from casos_migracao_legado)
      || ' | cobranças lidas=' || (select count(*) from cobrancas_legadas)
      || ' | coletas=' || (select count(*) from coletas_legado)
      || ' | casos já MIGRADOS (têm contrato no sistema)=' || (select count(*) from casos_migracao_legado where status = 'MIGRADO')"
MIGRADOS=$(docker exec "$DBCID" psql -U azit -d azit -tAc "select count(*) from casos_migracao_legado where status = 'MIGRADO'" | tr -d ' \r')
if [ "${MIGRADOS:-0}" != "0" ]; then
  erro "Há $MIGRADOS caso(s) MIGRADO(s): o contrato deles já existe no sistema. Apagar a bancada não desfaz contrato — ABORTADO."
  exit 1
fi
echo
aviso "Isto apaga a bancada inteira (casos, cobranças lidas, coletas e PDFs anexados) do stack $STACK."
aviso "Nada mais é tocado. Para refazer, basta 'Ler o Asaas' de novo na tela."
confirmar "LIMPAR-LEGADO-$STACK" "Digite LIMPAR-LEGADO-$STACK para continuar: " || exit 1

etapa "1/2 Tabelas da bancada"
docker exec "$DBCID" psql -U azit -d azit -q -c "TRUNCATE TABLE cobrancas_legadas, casos_migracao_legado, coletas_legado"
ok "casos_migracao_legado, cobrancas_legadas e coletas_legado zeradas"

etapa "2/2 PDFs anexados"
if [ -n "$BECID" ]; then
  docker exec "$BECID" sh -lc 'rm -rf /app/apps/backend/uploads/legado && echo "  uploads/legado removido"' || aviso "não consegui remover uploads/legado (backend fora?)"
else
  aviso "backend fora do ar — uploads/legado fica para a próxima"
fi

echo
ok "Bancada do legado descartada em $STACK. O restante do sistema não foi tocado."
