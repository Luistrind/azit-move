#!/usr/bin/env bash
# Move UMA parcela em aberto (e a fatura que a carrega) para o FINAL do contrato:
# novo vencimento = último vencimento do contrato + um período (7/14/30 dias).
# Caso real 05/11/2026 (Luís): Cleudione, contrato 2026080005, parcela de 26/10
# vai para depois da 161/161 (24/09/2029 → 01/10/2029).
#
# O que muda, só para a parcela informada: vencimento da parcela, data prevista
# do recebível, vencimento/fechamento/referência da FATURA dela (deslocados pelos
# mesmos dias), dataFim do item contratado se a parcela passar dele, e o
# vencimento da cobrança no Asaas (a fatura vencida volta a "pendente" lá).
# Número e rótulo da parcela ("9/161") não mudam.
#
# Só roda quando: a parcela está em aberto (sem pagamento e fora de acordo), a
# fatura dela está ABERTA ou FECHADA sem pagamento e carrega SÓ esta parcela
# (fatura mista — outra parcela, deste ou de outro contrato — aborta).
#
# Uso (no servidor, como root, com o arquivo em deploy/):
#   bash deploy/mover-parcela-final.sh azit <nº do contrato> <AAAA-MM-DD da parcela>
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"; NUMERO="${2:-}"; VENC="${3:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/mover-parcela-final.sh azit|azit-hml <nº do contrato> <AAAA-MM-DD da parcela>"; exit 1 ;; esac
[[ -n "$NUMERO" && "$VENC" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { erro "Informe o nº do contrato e o vencimento da parcela (AAAA-MM-DD)"; exit 1; }

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
BECID=$(container_do_servico "${STACK}_backend")
SQL() { docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -tA "$@"; }

etapa "Contrato $NUMERO em $STACK — parcela de $VENC"
read -r CID TITULAR STATUS PERIODICIDADE <<<"$(SQL -F' ' -c "
  select c.id, replace(t.nome,' ','_'), c.status, c.periodicidade
  from contratos_credito c join contas k on k.id = c.\"contaId\" join titulares t on t.id = k.\"titularId\"
  where c.numero = '$NUMERO' and c.\"deletedAt\" is null" | tr -d '\r')"
[ -n "${CID:-}" ] || { erro "Contrato $NUMERO não encontrado"; exit 1; }
[ "$STATUS" = "ATIVO" ] || { erro "Contrato não está em vida (fase $STATUS) — ABORTADO"; exit 1; }
case "$PERIODICIDADE" in SEMANAL) PASSO=7 ;; QUINZENAL) PASSO=14 ;; MENSAL) PASSO=30 ;; *) erro "Periodicidade $PERIODICIDADE desconhecida"; exit 1 ;; esac
echo "  titular: ${TITULAR//_/ } · $PERIODICIDADE (passo $PASSO dias)"

read -r PID DISPLAY PSTATUS ACORDO FID <<<"$(SQL -F' ' -c "
  select id, display, coalesce(status::text,'-'), coalesce(\"acordoId\",'-'), coalesce(\"faturaId\",'-')
  from parcelas where \"contratoId\"='$CID' and \"deletedAt\" is null and \"dataVencimento\"::date = date '$VENC'" | tr -d '\r')"
[ -n "${PID:-}" ] || { erro "Nenhuma parcela deste contrato vence em $VENC"; exit 1; }
[ "$PSTATUS" = "-" ] || { erro "Parcela $DISPLAY já tem status $PSTATUS (paga/extinta) — ABORTADO"; exit 1; }
[ "$ACORDO" = "-" ] || { erro "Parcela $DISPLAY está coberta por acordo — ABORTADO"; exit 1; }
[ "$FID" != "-" ] || { erro "Parcela $DISPLAY não tem fatura — ABORTADO"; exit 1; }

read -r FNUM FSTATUS FPAGO CHARGE FVENC <<<"$(SQL -F' ' -c "
  select numero, status, coalesce(\"valorPago\"::text,'0'), coalesce(\"asaasChargeId\",'-'), to_char(\"dataVencimento\",'YYYY-MM-DD')
  from faturas where id='$FID'" | tr -d '\r')"
[[ "$FSTATUS" = "ABERTA" || "$FSTATUS" = "FECHADA" ]] || { erro "Fatura #$FNUM está $FSTATUS — ABORTADO"; exit 1; }
[ "$FPAGO" = "0" ] || { erro "Fatura #$FNUM tem valor pago registrado ($FPAGO) — ABORTADO"; exit 1; }
OUTRAS=$(SQL -c "select count(*) from parcelas where \"faturaId\"='$FID' and id<>'$PID'" | tr -d ' \r')
[ "$OUTRAS" = "0" ] || { erro "Fatura #$FNUM carrega mais $OUTRAS parcela(s) — este script só move fatura de uma parcela — ABORTADO"; exit 1; }
ITENS_ALHEIOS=$(SQL -c "select count(*) from itens_fatura i join parcelas p on p.id = i.\"parcelaId\" where i.\"faturaId\"='$FID' and p.\"contratoId\"<>'$CID'" | tr -d ' \r')
[ "$ITENS_ALHEIOS" = "0" ] || { erro "Fatura #$FNUM tem item de outro contrato — ABORTADO"; exit 1; }

ULTIMO=$(SQL -c "select to_char(max(\"dataVencimento\"),'YYYY-MM-DD') from parcelas where \"contratoId\"='$CID' and \"deletedAt\" is null" | tr -d ' \r')
NOVO=$(SQL -c "select to_char(date '$ULTIMO' + interval '$PASSO day','YYYY-MM-DD')" | tr -d ' \r')
DIAS=$(SQL -c "select (date '$NOVO' - date '$VENC')" | tr -d ' \r')

echo
echo "  parcela $DISPLAY · fatura #$FNUM ($FSTATUS, vence $FVENC, $( [ "$CHARGE" = "-" ] && echo 'sem cobrança' || echo "asaas $CHARGE" ))"
echo "  último vencimento do contrato hoje: $ULTIMO"
aviso "Vai mover a parcela $DISPLAY de $VENC para $NOVO (+$DIAS dias), junto com a fatura #$FNUM e a cobrança no Asaas."
confirmar "MOVER-$NUMERO" "Digite MOVER-$NUMERO para continuar: " || exit 1

etapa "1/2 Banco"
SQL -q -c "
begin;
update parcelas set \"dataVencimento\" = \"dataVencimento\" + interval '$DIAS day', \"updatedAt\" = now() where id = '$PID';
update recebiveis set \"dataPrevista\" = \"dataPrevista\" + interval '$DIAS day', \"updatedAt\" = now() where \"parcelaId\" = '$PID';
update faturas set \"dataVencimento\" = \"dataVencimento\" + interval '$DIAS day', \"periodoReferencia\" = \"periodoReferencia\" + interval '$DIAS day', \"dataFechamento\" = \"dataFechamento\" + interval '$DIAS day', \"updatedAt\" = now() where id = '$FID';
update itens_contratados set \"dataFim\" = date '$NOVO', \"updatedAt\" = now() where id = (select \"itemContratadoId\" from parcelas where id = '$PID') and \"dataFim\" < date '$NOVO';
insert into logs_auditoria (id, acao, entidade, \"entidadeId\", depois, \"createdAt\")
  values ('audit_' || substr(md5(random()::text), 1, 20), 'parcela_movida_para_o_final', 'contrato_credito', '$CID', json_build_object('parcela', '$DISPLAY', 'parcelaId', '$PID', 'faturaNumero', $FNUM, 'de', '$VENC', 'para', '$NOVO', 'dias', $DIAS, 'via', 'deploy/mover-parcela-final.sh')::jsonb, now());
commit;"
ok "parcela $DISPLAY e fatura #$FNUM agora vencem em $NOVO"

etapa "2/2 Cobrança no Asaas"
if [ "$CHARGE" = "-" ]; then
  ok "fatura sem cobrança emitida — o sistema emite no D-5 com a data nova"
elif [ -z "$BECID" ]; then
  aviso "backend fora do ar: atualize o vencimento da cobrança $CHARGE no Asaas à mão para $NOVO"
else
  read -r AMB KEY <<<"$(SQL -F' ' -c "select \"asaasAmbiente\", coalesce(\"asaasApiKey\",'') from parametros_integracao limit 1" | tr -d '\r')"
  if [ -n "${KEY:-}" ]; then
    [ "$AMB" = "producao" ] && URL="https://api.asaas.com/v3" || URL="https://api-sandbox.asaas.com/v3"
  else
    URL=""; KEY=""
  fi
  docker exec -e CHARGE="$CHARGE" -e VENC="$NOVO" -e URL_DB="$URL" -e KEY_DB="$KEY" "$BECID" node -e '
    const base = process.env.URL_DB || process.env.ASAAS_API_URL || "";
    const key = process.env.KEY_DB || process.env.ASAAS_API_KEY || "";
    if (!base || !key) { console.error("  sem credencial do Asaas (central de integrações vazia e env sem chave)"); process.exit(1); }
    const url = base.replace(/\/$/, "") + "/payments/" + process.env.CHARGE;
    fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", access_token: key }, body: JSON.stringify({ dueDate: process.env.VENC }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); console.log("  " + j.id + " -> vence " + j.dueDate + " (" + j.status + ")"); })
      .catch((e) => { console.error("  FALHOU " + process.env.CHARGE + ": " + e.message); process.exit(1); });
  ' && ok "cobrança $CHARGE atualizada no Asaas para $NOVO" || aviso "cobrança $CHARGE NÃO atualizada — ajuste o vencimento no painel do Asaas para $NOVO"
fi

echo
ok "Pronto. Na ficha do titular a parcela $DISPLAY aparece no fim do cronograma, com vencimento $NOVO."
