#!/usr/bin/env bash
# Diagnóstico de ISOLAMENTO entre homologação e produção (21/09).
#
# Só LÊ. Não muda nada, não reinicia serviço, não escreve no banco.
# Responde, com prova: os dois ambientes compartilham banco, Redis, rede,
# volume, sessão (JWT) ou conta do Asaas?
#
# Uso (no servidor, como root):  bash deploy/diag-ambientes.sh
set -uo pipefail

STACKS="azit azit-hml"

titulo() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
sub()    { printf '\n\033[1m-- %s\033[0m\n' "$1"; }
impressao_digital() { # nunca imprime o segredo, só um hash curto para comparar
  local v="${1:-}"
  [ -z "$v" ] && { echo "(vazio)"; return; }
  printf '%s… (%d chars)\n' "$(printf '%s' "$v" | sha256sum | cut -c1-8)" "${#v}"
}
cont() { docker ps -q -f "name=^${1}\$" | head -1; }
serv() { docker ps -q -f "label=com.docker.swarm.service.name=${1}" | head -1; }

for S in $STACKS; do
  titulo "STACK $S"
  BE=$(serv "${S}_backend"); DB=$(serv "${S}_azit-db"); RD=$(serv "${S}_azit-redis")
  if [ -z "$BE" ] || [ -z "$DB" ]; then
    echo "  backend=$BE  banco=$DB  -> serviço fora do ar, pulando"
    continue
  fi
  echo "  container backend : $BE"
  echo "  container banco   : $DB"
  echo "  container redis   : ${RD:-(fora)}"

  sub "1. Qual banco o backend enxerga"
  URL=$(docker exec "$BE" sh -lc 'echo "$DATABASE_URL"' 2>/dev/null)
  echo "  DATABASE_URL  : $(printf '%s' "$URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"
  echo "  azit-db resolve para : $(docker exec "$BE" sh -lc 'getent hosts azit-db || nslookup azit-db 2>/dev/null | tail -2' 2>/dev/null | tr '\n' ' ')"
  echo "  IP do container do banco deste stack : $(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$DB")"

  sub "2. Identidade do cluster Postgres (PROVA de banco compartilhado)"
  echo -n "  system_identifier : "
  docker exec "$DB" psql -U azit -d azit -tAc "select system_identifier from pg_control_system()" 2>/dev/null
  echo -n "  bancos no cluster : "
  docker exec "$DB" psql -U azit -d postgres -tAc "select string_agg(datname,', ') from pg_database where datistemplate=false" 2>/dev/null

  sub "3. Volume de dados"
  docker inspect -f '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' "$DB" | sed 's/^/  /'

  sub "4. Redes do backend"
  docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}  {{$k}} ({{$v.IPAddress}}){{"\n"}}{{end}}' "$BE"

  sub "5. Segredos — só a impressão digital, para comparar entre os stacks"
  for V in JWT_SECRET ASAAS_WEBHOOK_SECRET MCP_SECRET POSTGRES_PASSWORD; do
    printf '  %-22s %s' "$V" ""
    impressao_digital "$(docker exec "$BE" sh -lc "echo \"\$$V\"" 2>/dev/null | tr -d '\r\n')"
  done
  printf '  %-22s %s\n' "AMBIENTE" "$(docker exec "$BE" sh -lc 'echo "$AMBIENTE"' 2>/dev/null)"
  printf '  %-22s %s\n' "ASAAS_API_URL(env)" "$(docker exec "$BE" sh -lc 'echo "$ASAAS_API_URL"' 2>/dev/null)"
  printf '  %-22s %s' "ASAAS_API_KEY(env)" ""
  impressao_digital "$(docker exec "$BE" sh -lc 'echo "$ASAAS_API_KEY"' 2>/dev/null | tr -d '\r\n')"

  sub "6. Asaas EFETIVO (banco > env — o que o sistema usa de verdade)"
  docker exec "$DB" psql -U azit -d azit -tAc "
    select '  ambiente=' || coalesce(\"asaasAmbiente\",'?')
        || ' | chave=' || coalesce(left(md5(\"asaasApiKey\"),8),'(sem chave)')
        || ' | segredo do webhook=' || coalesce(left(md5(\"asaasWebhookSecret\"),8),'(sem)')
        || ' | atualizado=' || coalesce(to_char(\"updatedAt\",'DD/MM/YYYY HH24:MI'),'-')
      from parametros_integracao" 2>/dev/null || echo "  (tabela parametros_integracao não encontrada)"

  sub "7. Movimento — volume e os 5 registros mais recentes"
  docker exec "$DB" psql -U azit -d azit -tAc "
    select '  usuarios=' || (select count(*) from usuarios)
        || ' | titulares=' || (select count(*) from titulares)
        || ' | contas=' || (select count(*) from contas)
        || ' | contratos=' || (select count(*) from contratos_credito)
        || ' | ativos=' || (select count(*) from ativos)
        || ' | faturas=' || (select count(*) from faturas)" 2>/dev/null
  echo "  últimos titulares criados:"
  docker exec "$DB" psql -U azit -d azit -tAc "
    select '    ' || to_char(\"createdAt\",'DD/MM HH24:MI') || '  ' || nome || '  (' || coalesce(\"cpfCnpj\",'-') || ')'
      from titulares order by \"createdAt\" desc limit 5" 2>/dev/null
  echo "  últimos contratos criados:"
  docker exec "$DB" psql -U azit -d azit -tAc "
    select '    ' || to_char(\"createdAt\",'DD/MM HH24:MI') || '  ' || numero || '  ' || status
      from contratos_credito order by \"createdAt\" desc limit 5" 2>/dev/null

  # Guarda as chaves de identidade para cruzar os dois ambientes no fim.
  docker exec "$DB" psql -U azit -d azit -tAc     "select \"cpfCnpj\" from titulares where \"cpfCnpj\" is not null order by 1" 2>/dev/null | tr -d ' ' | sort -u > "/tmp/diag_cpf_$S"
  docker exec "$DB" psql -U azit -d azit -tAc     "select \"asaasCustomerId\" from titulares where \"asaasCustomerId\" is not null order by 1" 2>/dev/null | tr -d ' ' | sort -u > "/tmp/diag_asaas_$S"
done

titulo "DADOS DE TESTE DO SEED DENTRO DA PRODUÇÃO"
# Os 7 titulares fictícios do prisma/seed.ts. Se aparecerem na produção, alguém
# rodou um seed contra o stack azit (deploy/seed.sh mira SEMPRE a produção).
SEED_CPF="'52998224725','39053344705','11144477735','11222333000181','86288366757','52341787809','70179723408'"
DBP=$(serv "azit_azit-db")
if [ -n "$DBP" ]; then
  docker exec "$DBP" psql -U azit -d azit -tAc "
    select '  ' || to_char(\"createdAt\",'DD/MM/YYYY HH24:MI') || '  ' || nome || '  (' || \"cpfCnpj\" || ')'
      from titulares where \"cpfCnpj\" in ($SEED_CPF) order by \"createdAt\"" 2>/dev/null
  N=$(docker exec "$DBP" psql -U azit -d azit -tAc "select count(*) from titulares where \"cpfCnpj\" in ($SEED_CPF)" 2>/dev/null | tr -d ' \r')
  if [ "${N:-0}" = "0" ]; then
    echo "  nenhum titular do seed na produção — o seed NÃO rodou aqui"
  else
    printf '\033[1;31m  %s titular(es) do seed dentro da PRODUÇÃO — um seed rodou contra o stack azit.\033[0m\n' "$N"
  fi
  echo "  usuários com senha padrão de teste (azit123) na produção:"
  docker exec "$DBP" psql -U azit -d azit -tAc "
    select '    ' || email || '  criado em ' || to_char(\"createdAt\",'DD/MM/YYYY HH24:MI')
      from usuarios where email in ('diretor@azit.com.br','aprovador@azit.com.br','operador@azit.com.br','financeiro@azit.com.br')
      order by \"createdAt\"" 2>/dev/null
fi

titulo "CRUZAMENTO — os mesmos registros existem nos DOIS ambientes?"
if [ -s /tmp/diag_cpf_azit ] && [ -s /tmp/diag_cpf_azit-hml ]; then
  N=$(comm -12 /tmp/diag_cpf_azit /tmp/diag_cpf_azit-hml | grep -c .)
  echo "  CPF/CNPJ presentes nos dois: $N"
  comm -12 /tmp/diag_cpf_azit /tmp/diag_cpf_azit-hml | head -20 | sed 's/^/    /'
  A=$(comm -12 /tmp/diag_asaas_azit /tmp/diag_asaas_azit-hml | grep -c .)
  echo "  MESMO cliente do Asaas (asaasCustomerId) nos dois: $A"
  comm -12 /tmp/diag_asaas_azit /tmp/diag_asaas_azit-hml | head -20 | sed 's/^/    /'
  echo "  (asaasCustomerId repetido = os dois ambientes estão na MESMA conta do Asaas)"
else
  echo "  (não deu para comparar — algum dos bancos não respondeu)"
fi
rm -f /tmp/diag_cpf_* /tmp/diag_asaas_*

titulo "VEREDITO"
IDS=""
for S in $STACKS; do
  DB=$(serv "${S}_azit-db"); [ -z "$DB" ] && continue
  ID=$(docker exec "$DB" psql -U azit -d azit -tAc "select system_identifier from pg_control_system()" 2>/dev/null | tr -d ' \r\n')
  echo "  $S -> cluster $ID"
  IDS="$IDS $ID"
done
UNICOS=$(echo $IDS | tr ' ' '\n' | sort -u | grep -c .)
QTD=$(echo $IDS | wc -w)
if [ "$QTD" -ge 2 ] && [ "$UNICOS" -lt "$QTD" ]; then
  printf '\n\033[1;31m  BANCO COMPARTILHADO: os stacks apontam para o MESMO cluster Postgres.\033[0m\n'
else
  printf '\n\033[1;32m  Bancos SEPARADOS: cada stack tem seu próprio cluster Postgres.\033[0m\n'
  echo "  Se ainda assim apareceu dado de um ambiente no outro, a porta de entrada"
  echo "  foi outra (Asaas na mesma conta, JWT com a mesma impressão digital acima,"
  echo "  restauração de backup cruzada ou script rodado no stack errado)."
fi

titulo "PUBLICAÇÕES RECENTES (quem subiu o quê)"
tail -5 /opt/azit-backups/homolog.log 2>/dev/null | sed 's/^/  hml: /'
tail -5 /opt/azit-backups/releases.log 2>/dev/null | sed 's/^/  prd: /'
ls -lt /opt/azit-backups/azit/*.gz 2>/dev/null | head -5 | sed 's/^/  backup prd: /'
ls -lt /opt/azit-backups/azit-hml/*.gz 2>/dev/null | head -5 | sed 's/^/  backup hml: /'
