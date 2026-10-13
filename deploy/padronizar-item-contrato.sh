#!/usr/bin/env bash
# Padroniza a descrição do item principal de UM contrato de veículo e dos itens
# das faturas dele para o modelo de hoje: "Parcela n/N · Compra Parcelada <veículo
# ATUAL do contrato>" (caso real 13/10/2026: contrato nascido de novação em
# contrato único saiu como "Compra Parcelada (novação em contrato único)" — e o
# veículo era o da troca, não o antigo).
#
# Lê o veículo do próprio contrato (ativos.descricao), mostra o antes/depois e
# só grava com confirmação. Não mexe em valor, parcela, proteção nem em faturas
# de outros contratos.
#
# Uso (no servidor, como root):
#   bash deploy/padronizar-item-contrato.sh azit <nº do contrato>
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"; NUMERO="${2:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/padronizar-item-contrato.sh azit|azit-hml <nº do contrato>"; exit 1 ;; esac
[ -n "$NUMERO" ] || { erro "Informe o nº do contrato"; exit 1; }

DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }
SQL() { docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -tA "$@"; }

etapa "Contrato $NUMERO em $STACK"
read -r CID STATUS TITULAR <<<"$(SQL -F' ' -c "
  select c.id, c.status, replace(t.nome,' ','_')
  from contratos_credito c join contas k on k.id = c.\"contaId\" join titulares t on t.id = k.\"titularId\"
  where c.numero = '$NUMERO' and c.\"deletedAt\" is null" | tr -d '\r')"
[ -n "${CID:-}" ] || { erro "Contrato $NUMERO não encontrado"; exit 1; }
VEICULO=$(SQL -c "select a.descricao from contratos_credito c join ativos a on a.id = c.\"ativoId\" where c.id = '$CID'" | tr -d '\r')
[ -n "$VEICULO" ] || { erro "Contrato sem veículo vinculado — este script é só para contrato de veículo"; exit 1; }
ITEMID=$(SQL -c "select id from itens_contratados where \"contratoId\"='$CID' and natureza='PARCELADO' order by \"createdAt\" limit 1" | tr -d '\r')
[ -n "$ITEMID" ] || { erro "Contrato sem item principal (compra parcelada)"; exit 1; }
ANTES=$(SQL -c "select descricao from itens_contratados where id='$ITEMID'" | tr -d '\r')
NOVA="Compra Parcelada $VEICULO"
echo "  titular: ${TITULAR//_/ } · status: $STATUS · veículo atual: $VEICULO"
echo "  item hoje:  $ANTES"
echo "  item novo:  $NOVA"
[ "$ANTES" != "$NOVA" ] || { ok "já está no padrão — nada a fazer"; exit 0; }

# Itens de fatura PRINCIPAL das parcelas deste contrato: "Parcela n/N · <item>".
NITENS=$(SQL -c "select count(*) from itens_fatura i join parcelas p on p.id = i.\"parcelaId\" where p.\"contratoId\"='$CID' and i.tipo='PRINCIPAL'" | tr -d ' \r')
echo
echo "  Itens de fatura (os 3 primeiros):"
SQL -F' | ' -c "
  select 'fatura #'||f.numero, i.descricao, i.valor
  from itens_fatura i join parcelas p on p.id = i.\"parcelaId\" join faturas f on f.id = i.\"faturaId\"
  where p.\"contratoId\"='$CID' and i.tipo='PRINCIPAL' order by f.\"dataVencimento\" limit 3" | sed 's/^/    /'
echo
aviso "Vai renomear o item do contrato e $NITENS item(ns) de fatura para \"Parcela n/N · $NOVA\"."
confirmar "PADRONIZAR" "Digite PADRONIZAR para continuar: " || exit 1

docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 -q -v cid="$CID" -v itemid="$ITEMID" -v nova="$NOVA" -v antes="$ANTES" <<'SQLEOF'
begin;
update itens_contratados set descricao = :'nova', "updatedAt" = now() where id = :'itemid';
update itens_fatura i set descricao = regexp_replace(i.descricao, ' · .*$', ' · ' || :'nova')
  from parcelas p where p.id = i."parcelaId" and p."contratoId" = :'cid' and i.tipo = 'PRINCIPAL';
insert into logs_auditoria (id, acao, entidade, "entidadeId", antes, depois, "createdAt")
  values ('audit_' || substr(md5(random()::text), 1, 20), 'contrato_item_padronizado', 'contrato_credito', :'cid',
          json_build_object('descricao', :'antes')::jsonb, json_build_object('descricao', :'nova', 'via', 'deploy/padronizar-item-contrato.sh')::jsonb, now());
commit;
SQLEOF
ok "item do contrato e $NITENS item(ns) de fatura agora como \"$NOVA\" — confira a ficha do titular"
