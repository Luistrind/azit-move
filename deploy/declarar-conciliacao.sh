#!/usr/bin/env bash
# Sobe a CONCILIAÇÃO DECLARADA de um caso do legado (doc 02 §26.15): o
# cronograma validado caso a caso, parcela a parcela, em JSON — substitui as
# regras da bancada para aquele caso. O caso precisa estar COLETADO ou EM
# REVISÃO (não validado/migrado). Depois, na tela: conferir → Validar → Migrar.
#
# Uso (no servidor, como root):
#   bash deploy/declarar-conciliacao.sh azit <id do caso OU cus_… do Asaas> <arquivo.json>
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"; CASO="${2:-}"; ARQ="${3:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/declarar-conciliacao.sh azit|azit-hml <caso|cus_…> <arquivo.json>"; exit 1 ;; esac
[ -n "$CASO" ] && [ -f "$ARQ" ] || { erro "Informe o caso e um arquivo JSON existente"; exit 1; }

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
SQL() { docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -tA "$@"; }
# O host não tem Node: a conferência do JSON roda no container do backend, lendo o arquivo pela entrada padrão.
BECID=$(container_do_servico "${STACK}_backend")
[ -n "$BECID" ] || { erro "Backend do stack $STACK não está rodando (preciso dele para conferir o JSON)"; exit 1; }
NODE() { docker exec -i "$BECID" node "$@"; }

NODE -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!Array.isArray(d.parcelas)||!d.parcelas.length) throw new Error("JSON sem parcelas[]"); const n=d.parcelas.map(p=>p.numero); if(new Set(n).size!==n.length) throw new Error("numero de parcela repetido"); for(const p of d.parcelas){ if(!/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento)) throw new Error("vencimento invalido na parcela "+p.numero); if(!["paga","paga_com_encargo","paga_por_acordo","em_acordo","vencida","pendente","nao_cobrada","adiada","futura"].includes(p.situacao)) throw new Error("situacao invalida na parcela "+p.numero);} console.log("  JSON ok: "+d.parcelas.length+" parcelas"+(d.entrada?", entrada":"")+(d.fora?", "+d.fora.length+" avulsa(s)":""));' < "$ARQ" || { erro "JSON inválido"; exit 1; }

etapa "Caso $CASO em $STACK"
read -r CID NOME STATUS <<<"$(SQL -F' ' -c "select id, replace(nome,' ','_'), status from casos_migracao_legado where id = '$CASO' or \"asaasCustomerId\" = '$CASO'" | tr -d '\r')"
[ -n "${CID:-}" ] || { erro "Caso não encontrado"; exit 1; }
echo "  ${NOME//_/ } · status $STATUS · id $CID"
case "$STATUS" in COLETADO|EM_REVISAO) ;; *) erro "Caso em $STATUS — só COLETADO ou EM_REVISAO aceitam declaração (reabra na tela se for VALIDADO)"; exit 1 ;; esac

# Cobranças citadas precisam existir no caso (senão a prova não fecha).
CITADAS=$(NODE -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const ids=new Set(); for(const p of [...(d.parcelas||[]),...(d.intermediarias||[])]) for(const c of (p.cobrancas||[])) ids.add(c); for(const f of (d.fora||[])) ids.add(f.cobranca); for(const c of ((d.entrada&&d.entrada.cobrancas)||[])) ids.add(c); console.log([...ids].join(","));' < "$ARQ")
if [ -n "$CITADAS" ]; then
  FALTAM=$(SQL -c "select string_agg(x, ', ') from unnest(string_to_array('$CITADAS', ',')) x where x not in (select \"asaasPaymentId\" from cobrancas_legadas where \"casoId\"='$CID')" | tr -d '\r')
  [ -z "$FALTAM" ] || { erro "Cobranças citadas que o caso não tem: $FALTAM — leia o Asaas de novo ou corrija o JSON"; exit 1; }
fi

JSON=$(cat "$ARQ")
aviso "Vai gravar a conciliação declarada do caso ${NOME//_/ } (substitui a declaração anterior, se houver)."
confirmar "DECLARAR" "Digite DECLARAR para continuar: " || exit 1

docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -q -v json="$JSON" -v cid="$CID" <<'SQLEOF'
begin;
insert into logs_auditoria (id, acao, entidade, "entidadeId", antes, depois, "createdAt")
  select 'audit_' || substr(md5(random()::text), 1, 20), 'legado_conciliacao_declarada', 'caso_migracao_legado', :'cid',
         "conciliacaoDeclarada", (:'json')::jsonb || jsonb_build_object('em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'por', null, 'origem', 'deploy/declarar-conciliacao.sh'), now()
  from casos_migracao_legado where id = :'cid';
update casos_migracao_legado
   set "conciliacaoDeclarada" = (:'json')::jsonb || jsonb_build_object('em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'por', null, 'origem', 'deploy/declarar-conciliacao.sh'),
       "updatedAt" = now()
 where id = :'cid';
commit;
SQLEOF
ok "declaração gravada — abra o caso na tela: aviso 'Conciliação declarada', depois Validar e Migrar"
