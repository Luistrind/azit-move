#!/usr/bin/env bash
# Desloca TODO o cronograma de UM contrato em N dias (caso real 09/10/2026:
# ativação com a 1ª parcela uma semana depois da APROVAÇÃO, e não uma semana
# depois do pagamento da entrada — cronograma inteiro 2 dias adiantado; caso
# 13/10/2026: contrato nascido de NOVAÇÃO seguiu o ciclo das origens e a 1ª
# parcela precisava cair 6 dias depois).
#
# O que muda, só para o contrato informado: dataPrimeiraParcela do contrato,
# dataInicio/dataFim dos itens contratados, vencimento das parcelas, data
# prevista dos recebíveis e vencimento/fechamento/referência das FATURAS QUE
# CARREGAM PARCELAS DESTE CONTRATO. Cobrança já emitida no Asaas tem o
# vencimento atualizado lá também.
#
# Só roda em contrato SEM pagamento (nenhuma parcela paga, nenhuma fatura dele
# paga), cuja conta não tenha OUTRO contrato em andamento (encerrados — quitação,
# novação, rescisão — não contam: as faturas deles ficam como estão) e cujas
# faturas não misturem parcelas de outro contrato — fora disso, aborta sem tocar
# em nada.
#
# Uso (no servidor, como root, com o arquivo em deploy/):
#   bash deploy/deslocar-vencimentos.sh azit <nº do contrato> <dias>     (dias negativo adianta)
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"; NUMERO="${2:-}"; DIAS="${3:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/deslocar-vencimentos.sh azit|azit-hml <nº do contrato> <dias>"; exit 1 ;; esac
[[ -n "$NUMERO" && "$DIAS" =~ ^-?[0-9]+$ && "$DIAS" != "0" ]] || { erro "Informe o nº do contrato e os dias (inteiro ≠ 0)"; exit 1; }

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
BECID=$(container_do_servico "${STACK}_backend")
SQL() { docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -tA "$@"; }

etapa "Contrato $NUMERO em $STACK"
read -r CID CONTAID TITULAR PRIMEIRA STATUS <<<"$(SQL -F' ' -c "
  select c.id, c.\"contaId\", replace(t.nome,' ','_'), to_char(c.\"dataPrimeiraParcela\",'DD/MM/YYYY'), c.status
  from contratos_credito c join contas k on k.id = c.\"contaId\" join titulares t on t.id = k.\"titularId\"
  where c.numero = '$NUMERO' and c.\"deletedAt\" is null" | tr -d '\r')"
[ -n "${CID:-}" ] || { erro "Contrato $NUMERO não encontrado"; exit 1; }
echo "  titular: ${TITULAR//_/ } · status: $STATUS · 1ª parcela hoje: $PRIMEIRA"

# Faturas DESTE contrato = as que carregam parcela dele (a conta pode ter faturas
# de contratos encerrados — pagas, novadas — que não se mexem).
FATS="select distinct \"faturaId\" from parcelas where \"contratoId\"='$CID' and \"faturaId\" is not null"
OUTROS=$(SQL -c "select count(*) from contratos_credito where \"contaId\"='$CONTAID' and id<>'$CID' and \"deletedAt\" is null and status<>'ENCERRADO'" | tr -d ' \r')
ENCERRADOS=$(SQL -c "select count(*) from contratos_credito where \"contaId\"='$CONTAID' and id<>'$CID' and \"deletedAt\" is null and status='ENCERRADO'" | tr -d ' \r')
PAGAS=$(SQL -c "select count(*) from parcelas where \"contratoId\"='$CID' and status is not null" | tr -d ' \r')
FATPAGAS=$(SQL -c "select count(*) from faturas where id in ($FATS) and status not in ('ABERTA','FECHADA')" | tr -d ' \r')
MISTAS=$(SQL -c "select count(*) from parcelas where \"faturaId\" in ($FATS) and \"contratoId\"<>'$CID'" | tr -d ' \r')
[ "$OUTROS" = "0" ] || { erro "A conta tem outros $OUTROS contrato(s) em andamento: as faturas são consolidadas e este script não separa — ABORTADO"; exit 1; }
[ "$PAGAS" = "0" ] || { erro "Há $PAGAS parcela(s) com pagamento registrado — deslocar cronograma pago não é seguro — ABORTADO"; exit 1; }
[ "$FATPAGAS" = "0" ] || { erro "Há $FATPAGAS fatura(s) deste contrato paga(s) ou extinta(s) — ABORTADO"; exit 1; }
[ "$MISTAS" = "0" ] || { erro "Há fatura deste contrato com parcela de OUTRO contrato — ABORTADO"; exit 1; }
[ "$ENCERRADOS" = "0" ] || echo "  (a conta tem $ENCERRADOS contrato(s) encerrado(s) — as faturas deles não se mexem)"

echo
echo "  Faturas do contrato (as 6 primeiras):"
SQL -F' | ' -c "
  select 'fatura #'||numero, status, 'vence '||to_char(\"dataVencimento\",'DD/MM/YYYY'), 'fecha '||to_char(\"dataFechamento\",'DD/MM/YYYY'), coalesce('asaas '||\"asaasChargeId\",'sem cobrança')
  from faturas where id in ($FATS) and \"deletedAt\" is null order by \"dataVencimento\" limit 6" | sed 's/^/    /'
NPARC=$(SQL -c "select count(*) from parcelas where \"contratoId\"='$CID'" | tr -d ' \r')
NFAT=$(SQL -c "select count(*) from faturas where id in ($FATS) and \"deletedAt\" is null" | tr -d ' \r')
NOVA=$(SQL -c "select to_char(\"dataPrimeiraParcela\" + interval '$DIAS day','DD/MM/YYYY') from contratos_credito where id='$CID'" | tr -d ' \r')
echo
aviso "Vai deslocar $DIAS dia(s): $NPARC parcelas, $NPARC recebíveis, $NFAT faturas e a 1ª parcela do contrato ($PRIMEIRA → $NOVA)."
confirmar "DESLOCAR-$NUMERO" "Digite DESLOCAR-$NUMERO para continuar: " || exit 1

etapa "1/2 Banco"
SQL -q -c "
begin;
update contratos_credito set \"dataPrimeiraParcela\" = \"dataPrimeiraParcela\" + interval '$DIAS day', \"updatedAt\" = now() where id = '$CID';
update itens_contratados set \"dataInicio\" = \"dataInicio\" + interval '$DIAS day', \"dataFim\" = \"dataFim\" + interval '$DIAS day', \"updatedAt\" = now() where \"contratoId\" = '$CID';
update parcelas set \"dataVencimento\" = \"dataVencimento\" + interval '$DIAS day', \"updatedAt\" = now() where \"contratoId\" = '$CID';
update recebiveis set \"dataPrevista\" = \"dataPrevista\" + interval '$DIAS day', \"updatedAt\" = now() where \"contratoId\" = '$CID';
update faturas set \"dataVencimento\" = \"dataVencimento\" + interval '$DIAS day', \"periodoReferencia\" = \"periodoReferencia\" + interval '$DIAS day', \"dataFechamento\" = \"dataFechamento\" + interval '$DIAS day', \"updatedAt\" = now() where id in ($FATS) and \"deletedAt\" is null;
insert into logs_auditoria (id, acao, entidade, \"entidadeId\", depois, \"createdAt\")
  values ('audit_' || substr(md5(random()::text), 1, 20), 'contrato_vencimentos_deslocados', 'contrato_credito', '$CID', json_build_object('dias', $DIAS, 'primeiraParcelaAntes', '$PRIMEIRA', 'primeiraParcelaDepois', '$NOVA', 'faturas', $NFAT, 'via', 'deploy/deslocar-vencimentos.sh')::jsonb, now());
commit;"
ok "cronograma deslocado em $DIAS dia(s) — 1ª parcela agora em $NOVA"

etapa "2/2 Cobranças já emitidas no Asaas"
EMITIDAS=$(SQL -F' ' -c "select \"asaasChargeId\", to_char(\"dataVencimento\",'YYYY-MM-DD') from faturas where id in ($FATS) and \"asaasChargeId\" is not null and status in ('ABERTA','FECHADA')" | tr -d '\r')
if [ -z "$EMITIDAS" ]; then
  ok "nenhuma cobrança emitida ainda — o sistema emite no D-5 com as datas novas"
elif [ -z "$BECID" ]; then
  aviso "backend fora do ar: atualize o vencimento no Asaas à mão: $EMITIDAS"
else
  # Credencial EFETIVA: a da central de integrações (banco) manda; env é o reserva.
  read -r AMB KEY <<<"$(SQL -F' ' -c "select \"asaasAmbiente\", coalesce(\"asaasApiKey\",'') from parametros_integracao limit 1" | tr -d '\r')"
  if [ -n "${KEY:-}" ]; then
    [ "$AMB" = "producao" ] && URL="https://api.asaas.com/v3" || URL="https://api-sandbox.asaas.com/v3"
  else
    URL=""; KEY=""
  fi
  while read -r CHARGE VENC; do
    [ -n "$CHARGE" ] || continue
    docker exec -e CHARGE="$CHARGE" -e VENC="$VENC" -e URL_DB="$URL" -e KEY_DB="$KEY" "$BECID" node -e '
      const base = process.env.URL_DB || process.env.ASAAS_API_URL || "";
      const key = process.env.KEY_DB || process.env.ASAAS_API_KEY || "";
      if (!base || !key) { console.error("  sem credencial do Asaas (central de integrações vazia e env sem chave)"); process.exit(1); }
      const url = base.replace(/\/$/, "") + "/payments/" + process.env.CHARGE;
      fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", access_token: key }, body: JSON.stringify({ dueDate: process.env.VENC }) })
        .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); console.log("  " + j.id + " -> vence " + j.dueDate + " (" + j.status + ")"); })
        .catch((e) => { console.error("  FALHOU " + process.env.CHARGE + ": " + e.message); process.exit(1); });
    ' && ok "cobrança $CHARGE atualizada no Asaas para $VENC" || aviso "cobrança $CHARGE NÃO atualizada — ajuste o vencimento no painel do Asaas para $VENC"
  done <<<"$EMITIDAS"
fi

echo
ok "Pronto. Confira a ficha do titular: faturas e parcelas já aparecem com as datas novas."
