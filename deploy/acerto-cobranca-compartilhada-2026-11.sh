#!/usr/bin/env bash
# Acerto único (18/11/2026) — duas faturas, UMA cobrança.
#
# Na migração do legado, quando o Asaas cobrava a parcela e a intermediária
# (entrada diluída) na MESMA cobrança, o sistema ficou com duas faturas apontando
# para ela. Enquanto as duas já estavam pagas na migração, tudo certo. O caso que
# sobrou (Vinicius Andre, faturas nº 3 e nº 4, cobrança de R$ 1.005,00 paga em
# 18/11 com R$ 1.044,19): o pagamento baixou só a fatura da parcela, o valor da
# intermediária ficou como "pago a mais" nela e a fatura da intermediária
# continuou em aberto, aparecendo como vencida.
#
# O que faz, para cada fatura SÓ de intermediária, em aberto, cuja cobrança é a
# mesma de outra fatura da conta já paga com pelo menos o valor das duas:
#   - baixa a intermediária pelo valor dela, na data do pagamento da outra;
#   - tira esse valor do "pago" da outra (a multa e a atualização ficam nela,
#     como a migração gravou os pares que já vieram pagos);
#   - registra o antes e o depois em logs_auditoria.
# Soma do que entrou não muda. Idempotente: só toca no que está fora do lugar.
# Mostra ANTES e DEPOIS.
#
# Uso (no servidor, como root):
#   bash deploy/acerto-cobranca-compartilhada-2026-11.sh azit        (produção)
#   bash deploy/acerto-cobranca-compartilhada-2026-11.sh azit-hml    (homologação)
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/acerto-cobranca-compartilhada-2026-11.sh azit|azit-hml"; exit 1 ;; esac
DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }

etapa "Cobrança ligada a duas faturas em $STACK — baixa da intermediária paga junto"
docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 < deploy/sql/acerto-cobranca-compartilhada.sql
ok "Acerto concluído"
