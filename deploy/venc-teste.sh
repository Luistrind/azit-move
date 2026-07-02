#!/usr/bin/env bash
# TESTE: muda a data de vencimento da 1ª fatura ABERTA do titular "teste"
# para 06/07 (fechamento D-5 = 01/07, já passado) — pra exercitar o gatilho de cobrança.
set -euo pipefail
CID=$(docker ps -qf name=azit_azit-db | head -1)
if [ -z "${CID:-}" ]; then echo "Container do banco (azit_azit-db) não encontrado."; exit 1; fi

docker exec -i "$CID" psql -U azit -d azit -v ON_ERROR_STOP=1 <<'SQL'
\echo '== ANTES: titular "teste" + faturas ABERTAS =='
select tt.nome, fa.numero, fa."dataVencimento"::date as venc, fa."dataFechamento"::date as fechamento, fa.status
from titulares tt
join contas c on c."titularId" = tt.id
join faturas fa on fa."contaId" = c.id
where tt.nome ilike '%teste%' and fa.status = 'ABERTA'
order by tt."createdAt" desc, fa.numero asc;

\echo '== ALTERANDO a 1ª fatura aberta: venc = 2026-07-06, fechamento = 2026-07-01 =='
update faturas
set "dataVencimento" = '2026-07-06 12:00:00', "dataFechamento" = '2026-07-01 12:00:00'
where id = (
  select fa.id from titulares tt
  join contas c on c."titularId" = tt.id
  join faturas fa on fa."contaId" = c.id
  where tt.nome ilike '%teste%' and fa.status = 'ABERTA'
  order by tt."createdAt" desc, fa.numero asc
  limit 1
)
returning numero, "dataVencimento"::date as novo_venc, "dataFechamento"::date as novo_fechamento;
SQL
