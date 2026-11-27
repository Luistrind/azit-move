#!/usr/bin/env bash
# Concilia o RECEBIMENTO INICIAL de uma novação pago numa cobrança AVULSA do
# Asaas (criada à mão no painel), e não na cobrança que o sistema gerou.
# Caso real 27/11/2026 (Luís): Ingrid pagou a entrada da novação num link avulso.
#
# O que faz, na ordem:
#   1. acha a novação AGUARDANDO_RECEBIMENTO do titular e a cobrança que o
#      sistema gerou (que ficou em aberto);
#   2. acha no Asaas a cobrança avulsa PAGA (pelo id pay_… informado ou,
#      sem ele, entre as pagas do mesmo cliente nos últimos 15 dias) e confere:
#      paga, de outra cobrança, não usada em nada do sistema, valor >= entrada;
#   3. pede confirmação digitada;
#   4. aponta a novação (e o contrato novo) para a cobrança avulsa e enfileira
#      a MESMA ativação que o webhook enfileiraria (fila efetivar-acordo, job
#      novacao-recebida) — origens extintas, cronograma, lançamento da entrada;
#   5. ativada, remove do Asaas a cobrança gerada, se ainda estiver em aberto,
#      para o cliente não pagar duas vezes.
#
# Uso (no servidor, como root):
#   bash deploy/conciliar-recebimento-novacao.sh azit "<parte do nome do titular>" [pay_…]
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"; NOME="${2:-}"; AVULSA="${3:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/conciliar-recebimento-novacao.sh azit|azit-hml \"<nome do titular>\" [pay_…]"; exit 1 ;; esac
[ -n "$NOME" ] || { erro "Informe parte do nome do titular"; exit 1; }
[ -z "$AVULSA" ] || [[ "$AVULSA" =~ ^pay_[A-Za-z0-9]+$ ]] || { erro "O id da cobrança avulsa começa com pay_ (ex.: pay_abc123)"; exit 1; }

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
BECID=$(container_do_servico "${STACK}_backend")
[ -n "$BECID" ] || { erro "Backend do stack $STACK não está rodando (a ativação roda nele)"; exit 1; }
SQL() { docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -tA "$@"; }
NOME_SQL=${NOME//\'/\'\'}

etapa "1/5 Novação aguardando o recebimento"
LINHAS=$(SQL -F'|' -c "
  select n.id, t.nome, coalesce(n.\"asaasChargeIdRecebimento\",'-'), round(n.\"recebimentoInicial\"*100)::bigint,
         coalesce(c.numero,'-'), coalesce(c.id,'-')
  from novacoes n join contas k on k.id = n.\"contaId\" join titulares t on t.id = k.\"titularId\"
  left join contratos_credito c on c.id = n.\"contratoVeiculoId\"
  where n.\"deletedAt\" is null and n.status = 'AGUARDANDO_RECEBIMENTO' and t.nome ilike '%${NOME_SQL}%'" | tr -d '\r')
QTD=$(printf '%s' "$LINHAS" | grep -c . || true)
[ "$QTD" = "1" ] || {
  erro "Esperava 1 novação AGUARDANDO_RECEBIMENTO para \"$NOME\", achei $QTD"
  SQL -c "select t.nome, n.status, to_char(n.\"updatedAt\",'DD/MM HH24:MI') from novacoes n join contas k on k.id=n.\"contaId\" join titulares t on t.id=k.\"titularId\" where n.\"deletedAt\" is null and t.nome ilike '%${NOME_SQL}%' order by n.\"createdAt\" desc limit 5" | sed 's/^/  /'
  exit 1
}
IFS='|' read -r NID TITULAR GERADA ENTRADA CNUM CID <<<"$LINHAS"
echo "  titular: $TITULAR · contrato novo $CNUM"
echo "  recebimento inicial: R\$ $(printf '%d,%02d' $((ENTRADA/100)) $((ENTRADA%100))) · cobrança gerada: $GERADA"
[ "$GERADA" != "-" ] || { erro "A novação não tem cobrança gerada — caso diferente, ABORTADO"; exit 1; }

read -r AMB KEY <<<"$(SQL -F' ' -c "select \"asaasAmbiente\", coalesce(\"asaasApiKey\",'') from parametros_integracao limit 1" | tr -d '\r')"
if [ -n "${KEY:-}" ]; then
  [ "$AMB" = "producao" ] && URL="https://api.asaas.com/v3" || URL="https://api-sandbox.asaas.com/v3"
else URL=""; KEY=""; fi

# Node no backend: Asaas (fetch) e fila (bullmq). Saída: linhas "chave=valor".
NODE() { docker exec -i -w /app/apps/backend -e URL_DB="$URL" -e KEY_DB="$KEY" "$@" "$BECID" node; }

etapa "2/5 Cobranças no Asaas"
RES=$(NODE -e GERADA="$GERADA" -e AVULSA="$AVULSA" -e ENTRADA="$ENTRADA" <<'JS'
const base = (process.env.URL_DB || process.env.ASAAS_API_URL || '').replace(/\/$/, '');
const key = process.env.KEY_DB || process.env.ASAAS_API_KEY || '';
if (!base || !key) { console.log('erro=sem credencial do Asaas'); process.exit(0); }
// A ativação é enfileirada pelo bullmq do backend: confere ANTES de mexer em qualquer coisa.
try { require.resolve('bullmq'); } catch { console.log('erro=bullmq não encontrado no backend — nada foi alterado'); process.exit(0); }
const get = async (p) => { const r = await fetch(base + p, { headers: { access_token: key } }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j.errors ?? j)); return j; };
const pagas = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
(async () => {
  const g = await get('/payments/' + process.env.GERADA);
  console.log(`gerada_status=${g.status}`);
  console.log(`gerada_desc=${g.dueDate} R$ ${g.value} ${g.status}`);
  let a;
  if (process.env.AVULSA) a = await get('/payments/' + process.env.AVULSA);
  else {
    const desde = new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 10);
    const l = await get(`/payments?customer=${g.customer}&paymentDate[ge]=${desde}&limit=100`);
    const cand = (l.data || []).filter((p) => p.id !== g.id && pagas.includes(p.status));
    cand.forEach((p) => console.log(`candidata=${p.id} · pago ${p.paymentDate || p.clientPaymentDate} · R$ ${p.value} · ${p.billingType} · ${(p.description || '').slice(0, 50)}`));
    if (cand.length !== 1) { console.log(`erro=${cand.length} cobranças pagas do mesmo cliente além da gerada — rode de novo informando o pay_… da avulsa`); return; }
    a = cand[0];
  }
  if (a.id === g.id) { console.log('erro=a cobrança informada é a própria gerada — o webhook já cuidaria dela'); return; }
  if (!pagas.includes(a.status)) { console.log(`erro=a cobrança ${a.id} não está paga no Asaas (${a.status})`); return; }
  if (a.customer !== g.customer) console.log(`aviso=a avulsa é de outro cadastro de cliente no Asaas (${a.customer} × ${g.customer}) — confira o nome no painel`);
  const valor = Math.round(a.value * 100);
  console.log(`avulsa=${a.id}`);
  console.log(`avulsa_valor=${valor}`);
  console.log(`avulsa_data=${(a.paymentDate || a.clientPaymentDate || a.confirmedDate || '').slice(0, 10)}`);
  console.log(`avulsa_desc=pago ${a.paymentDate || a.clientPaymentDate} · R$ ${a.value} · ${a.billingType} · ${a.status} · ref "${a.externalReference || ''}"`);
})().catch((e) => console.log('erro=' + e.message));
JS
)
val() { printf '%s\n' "$RES" | sed -n "s/^$1=//p" | head -1; }
printf '%s\n' "$RES" | sed -n 's/^candidata=/  candidata: /p'
[ -z "$(val erro)" ] || { erro "$(val erro)"; exit 1; }
[ -z "$(val aviso)" ] || aviso "$(val aviso)"
echo "  gerada:  $GERADA · $(val gerada_desc)"
AV=$(val avulsa); AVALOR=$(val avulsa_valor); ADATA=$(val avulsa_data)
echo "  avulsa:  $AV · $(val avulsa_desc)"
case "$(val gerada_status)" in RECEIVED|CONFIRMED|RECEIVED_IN_CASH) erro "A cobrança GERADA também está paga — o webhook ativa sozinho; não concilie à mão. ABORTADO"; exit 1 ;; esac
[[ "$AVALOR" =~ ^[0-9]+$ && "$ADATA" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { erro "Não consegui ler valor/data da avulsa — ABORTADO"; exit 1; }
[ "$AVALOR" -ge "$ENTRADA" ] || { erro "A avulsa (R\$ $((AVALOR/100))) é MENOR que o recebimento inicial — entrada só vale inteira (doc 02 §32.6). ABORTADO"; exit 1; }
USADA=$(SQL -c "select (select count(*) from faturas where \"asaasChargeId\"='$AV') + (select count(*) from lancamentos_conta where \"asaasChargeId\"='$AV') + (select count(*) from novacoes where \"asaasChargeIdRecebimento\"='$AV') + (select count(*) from pagamentos_fatura where \"gatewayPaymentId\"='$AV')" | tr -d ' \r')
[ "$USADA" = "0" ] || { erro "A cobrança $AV já está ligada a algo no sistema ($USADA vínculo/s) — ABORTADO"; exit 1; }
[ "$AVALOR" -eq "$ENTRADA" ] || aviso "A avulsa é MAIOR que o recebimento inicial (diferença de R\$ $(( (AVALOR-ENTRADA)/100 ))) — a diferença NÃO vira crédito automático"

etapa "3/5 Confirmação"
echo "  Vai: ligar a novação de $TITULAR à cobrança $AV (paga em $ADATA), ativar a novação"
echo "  (contratos de origem extintos, cronograma do contrato $CNUM gerado) e remover a cobrança $GERADA do Asaas."
PRIMEIRO=$(printf '%s' "$TITULAR" | awk '{print toupper($1)}')
confirmar "CONCILIAR-$PRIMEIRO" "Digite CONCILIAR-$PRIMEIRO para continuar: " || exit 1

etapa "4/5 Vincular e ativar"
SQL -c "
begin;
update novacoes set \"asaasChargeIdRecebimento\" = '$AV', \"updatedAt\" = now() where id = '$NID' and status = 'AGUARDANDO_RECEBIMENTO';
update contratos_credito set \"entradaCobrancaAsaasId\" = '$AV', \"updatedAt\" = now() where id = '$CID' and \"entradaCobrancaAsaasId\" = '$GERADA';
insert into logs_auditoria (id, acao, entidade, \"entidadeId\", antes, depois, \"createdAt\")
  values ('audit_' || substr(md5(random()::text), 1, 20), 'novacao_recebimento_conciliado_manual', 'novacao', '$NID',
          json_build_object('cobrancaGerada', '$GERADA')::jsonb,
          json_build_object('cobrancaAvulsa', '$AV', 'valorRecebido', $AVALOR, 'pagoEm', '$ADATA', 'via', 'deploy/conciliar-recebimento-novacao.sh')::jsonb, now());
commit;" >/dev/null
ok "novação ligada à cobrança $AV"

NODE -e NID="$NID" -e ADATA="$ADATA" -e AVALOR="$AVALOR" -e AV="$AV" <<'JS'
const { Queue } = require('bullmq');
const u = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const connection = { host: u.hostname, port: Number(u.port || 6379), password: u.password ? decodeURIComponent(u.password) : undefined, db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined };
const q = new Queue('efetivar-acordo', { connection });
q.add('novacao-recebida', { novacaoId: process.env.NID, paymentDate: process.env.ADATA, valorRecebido: Number(process.env.AVALOR), pagamentoId: process.env.AV },
  { attempts: 5, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: true, removeOnFail: 50 })
  .then((j) => { console.log('  ativação enfileirada (job ' + j.id + ')'); return q.close(); })
  .catch((e) => { console.error('  FALHOU ao enfileirar: ' + e.message); process.exit(1); });
JS

STATUS=""
for _ in $(seq 1 30); do
  STATUS=$(SQL -c "select status from novacoes where id='$NID'" | tr -d ' \r')
  [ "$STATUS" = "AGUARDANDO_RECEBIMENTO" ] || break
  sleep 2
done
case "$STATUS" in
  ATIVO) ok "novação ATIVA — contrato $CNUM com cronograma" ;;
  AGUARDANDO_RECEBIMENTO) erro "A ativação ainda não rodou em 60 s. Veja: bash deploy/logs.sh $STACK backend | grep -i novação — a cobrança gerada NÃO foi removida"; exit 1 ;;
  *) erro "A novação ficou $STATUS — veja o log do backend; a cobrança gerada NÃO foi removida"; exit 1 ;;
esac

etapa "5/5 Cobrança gerada no Asaas"
NODE -e GERADA="$GERADA" <<'JS' && ok "cobrança $GERADA removida do Asaas" || aviso "remova a cobrança $GERADA à mão no painel do Asaas, para o cliente não pagar duas vezes"
const base = (process.env.URL_DB || process.env.ASAAS_API_URL || '').replace(/\/$/, '');
const key = process.env.KEY_DB || process.env.ASAAS_API_KEY || '';
(async () => {
  const r0 = await fetch(`${base}/payments/${process.env.GERADA}`, { headers: { access_token: key } });
  const g = await r0.json();
  if (!['PENDING', 'OVERDUE'].includes(g.status)) { console.log(`  a cobrança gerada está ${g.status} — não removida`); process.exit(g.deleted ? 0 : 1); }
  const r = await fetch(`${base}/payments/${process.env.GERADA}`, { method: 'DELETE', headers: { access_token: key } });
  const j = await r.json();
  if (!r.ok || !j.deleted) throw new Error(JSON.stringify(j));
})().catch((e) => { console.error('  FALHOU: ' + e.message); process.exit(1); });
JS

echo
SQL -c "select 'novação: ' || n.status || ' · contrato ' || c.numero || ': ' || c.status || ' · parcelas: ' || (select count(*) from parcelas p where p.\"contratoId\" = c.id and p.\"deletedAt\" is null) || ' · entrada lançada: ' || (select count(*) from lancamentos_conta l where l.\"contratoId\" = c.id and l.tipo = 'ENTRADA_CONTRATO') from novacoes n join contratos_credito c on c.id = n.\"contratoVeiculoId\" where n.id = '$NID'" | sed 's/^/  /'
ok "Pronto. Confira a ficha de $TITULAR."
