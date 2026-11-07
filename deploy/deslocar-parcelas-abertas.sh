#!/usr/bin/env bash
# Desloca em N dias SÓ AS PARCELAS EM ABERTO de um contrato (o que já foi pago
# fica como está). Caso real 06/11/2026 (Luís): Carmo, contrato 2026030001 —
# pagava na sexta e as 131 parcelas em aberto (36/166 em diante) estavam na
# quinta; +1 dia põe o resto do cronograma na sexta.
#
# Diferença para deploy/deslocar-vencimentos.sh: aquele move o cronograma
# INTEIRO e só roda em contrato sem pagamento; este serve ao contrato em
# andamento e não toca em parcela paga, coberta por acordo ou extinta.
#
# O que muda: vencimento das parcelas em aberto (status vazio, fora de acordo),
# data prevista dos recebíveis delas, vencimento/fechamento/referência das
# FATURAS que as carregam, dataFim dos itens contratados e o vencimento das
# cobranças já emitidas no Asaas (só quando a data nova não ficou no passado).
#
# Só roda quando as faturas dessas parcelas estão ABERTAS ou FECHADAS, sem
# pagamento, e não carregam parcela paga nem parcela de outro contrato — fora
# disso, aborta sem tocar em nada.
#
# Uso (no servidor, como root, com o arquivo em deploy/):
#   bash deploy/deslocar-parcelas-abertas.sh azit <nº do contrato> <dias>     (dias negativo adianta)
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"; NUMERO="${2:-}"; DIAS="${3:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/deslocar-parcelas-abertas.sh azit|azit-hml <nº do contrato> <dias>"; exit 1 ;; esac
[[ -n "$NUMERO" && "$DIAS" =~ ^-?[0-9]+$ && "$DIAS" != "0" ]] || { erro "Informe o nº do contrato e os dias (inteiro ≠ 0)"; exit 1; }

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
BECID=$(container_do_servico "${STACK}_backend")
SQL() { docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -tA "$@"; }
DIASEM="(array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])"

etapa "Contrato $NUMERO em $STACK — parcelas em aberto, $DIAS dia(s)"
read -r CID TITULAR STATUS <<<"$(SQL -F' ' -c "
  select c.id, replace(t.nome,' ','_'), c.status
  from contratos_credito c join contas k on k.id = c.\"contaId\" join titulares t on t.id = k.\"titularId\"
  where c.numero = '$NUMERO' and c.\"deletedAt\" is null" | tr -d '\r')"
[ -n "${CID:-}" ] || { erro "Contrato $NUMERO não encontrado"; exit 1; }
[ "$STATUS" = "ATIVO" ] || { erro "Contrato não está em vida (fase $STATUS) — ABORTADO"; exit 1; }
echo "  titular: ${TITULAR//_/ }"

# Parcelas-alvo: em aberto (sem status), fora de acordo. Faturas-alvo: as que as carregam.
ALVO="select id from parcelas where \"contratoId\"='$CID' and \"deletedAt\" is null and status is null and \"acordoId\" is null"
FATS="select distinct \"faturaId\" from parcelas where id in ($ALVO) and \"faturaId\" is not null"
NPARC=$(SQL -c "select count(*) from ($ALVO) x" | tr -d ' \r')
[ "$NPARC" != "0" ] || { erro "Contrato sem parcela em aberto — nada a deslocar"; exit 1; }
NFAT=$(SQL -c "select count(*) from faturas where id in ($FATS) and \"deletedAt\" is null" | tr -d ' \r')
FATRUINS=$(SQL -c "select count(*) from faturas where id in ($FATS) and (status not in ('ABERTA','FECHADA') or coalesce(\"valorPago\",0) > 0)" | tr -d ' \r')
ALHEIAS=$(SQL -c "select count(*) from parcelas where \"faturaId\" in ($FATS) and id not in ($ALVO)" | tr -d ' \r')
[ "$FATRUINS" = "0" ] || { erro "Há $FATRUINS fatura(s) dessas parcelas paga(s), com valor pago ou extinta(s) — ABORTADO"; exit 1; }
[ "$ALHEIAS" = "0" ] || { erro "Há $ALHEIAS parcela(s) paga(s), em acordo ou de outro contrato nas mesmas faturas — ABORTADO"; exit 1; }

echo
echo "  Dia da semana das parcelas em aberto hoje:"
SQL -F' ' -c "select '   ', ${DIASEM}[extract(dow from \"dataVencimento\")::int + 1], count(*) from parcelas where id in ($ALVO) group by 2 order by 3 desc" | sed 's/^/  /'
echo "  Primeiras parcelas (antes → depois):"
SQL -F' ' -c "
  select '   ', display, to_char(\"dataVencimento\",'DD/MM/YYYY'), ${DIASEM}[extract(dow from \"dataVencimento\")::int + 1], '→',
         to_char(\"dataVencimento\" + interval '$DIAS day','DD/MM/YYYY'), ${DIASEM}[extract(dow from \"dataVencimento\" + interval '$DIAS day')::int + 1]
  from parcelas where id in ($ALVO) order by \"dataVencimento\" limit 4" | sed 's/^/  /'
EMITIDAS_N=$(SQL -c "select count(*) from faturas where id in ($FATS) and \"asaasChargeId\" is not null" | tr -d ' \r')
echo
aviso "Vai deslocar $DIAS dia(s): $NPARC parcelas em aberto, $NFAT faturas ($EMITIDAS_N com cobrança no Asaas). Parcelas pagas não mudam."
confirmar "DESLOCAR-ABERTAS-$NUMERO" "Digite DESLOCAR-ABERTAS-$NUMERO para continuar: " || exit 1

etapa "1/2 Banco"
# As listas viram tabelas temporárias ANTES dos updates (as subconsultas dependem
# de colunas que os próprios updates mexem).
SQL -q -c "
begin;
create temporary table _alvo on commit drop as $ALVO;
create temporary table _fats on commit drop as select distinct \"faturaId\" as id from parcelas where id in (select id from _alvo) and \"faturaId\" is not null;
update parcelas set \"dataVencimento\" = \"dataVencimento\" + interval '$DIAS day', \"updatedAt\" = now() where id in (select id from _alvo);
update recebiveis set \"dataPrevista\" = \"dataPrevista\" + interval '$DIAS day', \"updatedAt\" = now() where \"parcelaId\" in (select id from _alvo);
update faturas set \"dataVencimento\" = \"dataVencimento\" + interval '$DIAS day', \"periodoReferencia\" = \"periodoReferencia\" + interval '$DIAS day', \"dataFechamento\" = \"dataFechamento\" + interval '$DIAS day', \"updatedAt\" = now() where id in (select id from _fats) and \"deletedAt\" is null;
update itens_contratados set \"dataFim\" = \"dataFim\" + interval '$DIAS day', \"updatedAt\" = now() where \"contratoId\" = '$CID' and \"dataFim\" is not null and status = 'ATIVO';
insert into logs_auditoria (id, acao, entidade, \"entidadeId\", depois, \"createdAt\")
  values ('audit_' || substr(md5(random()::text), 1, 20), 'parcelas_abertas_deslocadas', 'contrato_credito', '$CID', json_build_object('dias', $DIAS, 'parcelas', $NPARC, 'faturas', $NFAT, 'via', 'deploy/deslocar-parcelas-abertas.sh')::jsonb, now());
commit;"
ok "$NPARC parcelas em aberto e $NFAT faturas deslocadas em $DIAS dia(s)"

etapa "2/2 Cobranças já emitidas no Asaas"
# Depois do commit as parcelas-alvo continuam sendo as em aberto do contrato.
HOJE=$(SQL -c "select to_char((now() at time zone 'America/Sao_Paulo')::date,'YYYY-MM-DD')" | tr -d ' \r')
EMITIDAS=$(SQL -F' ' -c "select \"asaasChargeId\", to_char(\"dataVencimento\",'YYYY-MM-DD') from faturas where id in ($FATS) and \"asaasChargeId\" is not null and status in ('ABERTA','FECHADA') order by \"dataVencimento\"" | tr -d '\r')
if [ -z "$EMITIDAS" ]; then
  ok "nenhuma cobrança emitida ainda — o sistema emite no D-5 com as datas novas"
elif [ -z "$BECID" ]; then
  aviso "backend fora do ar: atualize o vencimento no Asaas à mão: $EMITIDAS"
else
  read -r AMB KEY <<<"$(SQL -F' ' -c "select \"asaasAmbiente\", coalesce(\"asaasApiKey\",'') from parametros_integracao limit 1" | tr -d '\r')"
  if [ -n "${KEY:-}" ]; then
    [ "$AMB" = "producao" ] && URL="https://api.asaas.com/v3" || URL="https://api-sandbox.asaas.com/v3"
  else
    URL=""; KEY=""
  fi
  while read -r CHARGE VENC; do
    [ -n "$CHARGE" ] || continue
    if [[ "$VENC" < "$HOJE" ]]; then
      aviso "cobrança $CHARGE: a data nova ($VENC) já passou — o Asaas não aceita vencimento no passado; ela segue vencida lá"
      continue
    fi
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
ok "Pronto. Confira a ficha do titular: as parcelas em aberto aparecem com as datas novas."
