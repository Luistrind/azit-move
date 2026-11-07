#!/usr/bin/env bash
# Acerto único (04/11/2026) para novações feitas ANTES da v1.4.4, em dois pontos:
#
# 1) Novação ATIVA cujo contrato novo não tem o lançamento "Entrada do contrato"
#    (caso Bruno Alessandro, 2026110005): o recebimento inicial pago ficou só no
#    Asaas — não aparecia na ficha, na Carteira nem como entrada paga do contrato.
#    Cria o lançamento ENTRADA_CONTRATO a partir da própria novação (valor,
#    cobrança e data de ativação já gravados) e, em contrato único, marca
#    entradaPagaEm/valorEntradaPago no contrato novo.
#
# 2) Novação AGUARDANDO_RECEBIMENTO cujo contrato novo ainda está em
#    AGUARDANDO_ASSINATURA (caso Genival, 2026110001): assinado por todos e com a
#    cobrança do recebimento inicial no ar, o contrato passa a
#    AGUARDANDO_PAGAMENTO_INICIAL com o id da cobrança, como na venda.
#
# Idempotente: só toca no que ainda está fora do lugar. Mostra ANTES e DEPOIS.
#
# Uso (no servidor, como root):
#   bash deploy/acerto-novacao-2026-11.sh azit        (produção)
#   bash deploy/acerto-novacao-2026-11.sh azit-hml    (homologação)
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

STACK="${1:-}"
case "$STACK" in azit|azit-hml) ;; *) erro "Uso: bash deploy/acerto-novacao-2026-11.sh azit|azit-hml"; exit 1 ;; esac
DBCID=$(container_do_servico "${STACK}_azit-db")
[ -n "$DBCID" ] || { erro "Banco do stack $STACK não está rodando"; exit 1; }

etapa "Novações em $STACK — acerto da entrada e do estado do contrato novo"
docker exec -i "$DBCID" psql -U azit -d azit -v ON_ERROR_STOP=1 <<'SQL'
\echo '== ANTES =='
select c.numero, n.status as novacao, c.status as contrato, n."recebimentoInicial" as recebimento,
       n."dataAtivacao"::date as ativacao, c."entradaPagaEm"::date as entrada_paga_em,
       (select count(*) from lancamentos_conta l where l."contratoId" = c.id and l.tipo = 'ENTRADA_CONTRATO') as lancamentos_entrada
from novacoes n join contratos_credito c on c.id = n."contratoVeiculoId"
where n."deletedAt" is null and n.status in ('ATIVO', 'AGUARDANDO_RECEBIMENTO')
order by c.numero;

\echo '== 1) Entrada da novação ativa vira lançamento do contrato novo =='
insert into lancamentos_conta (id, "contaId", "contratoId", tipo, descricao, valor, "dataPagamento", "asaasChargeId", "createdAt", "updatedAt")
select 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
       n."contaId", c.id, 'ENTRADA_CONTRATO',
       'Entrada do contrato ' || c.numero || ' (recebimento inicial da novação)',
       n."recebimentoInicial", coalesce(n."dataAtivacao", now()), n."asaasChargeIdRecebimento", now(), now()
from novacoes n join contratos_credito c on c.id = n."contratoVeiculoId"
where n."deletedAt" is null and n.status = 'ATIVO' and n."recebimentoInicial" > 0
  and not exists (select 1 from lancamentos_conta l where l."contratoId" = c.id and l.tipo = 'ENTRADA_CONTRATO');

update contratos_credito c
set "entradaPagaEm" = coalesce(n."dataAtivacao", now()), "valorEntradaPago" = n."recebimentoInicial", "updatedAt" = now()
from novacoes n
where n."contratoVeiculoId" = c.id and n."deletedAt" is null and n.status = 'ATIVO'
  and n."recebimentoInicial" > 0 and c."entradaPagaEm" is null
  -- só contrato ÚNICO: ali a entrada do contrato É o recebimento inicial. Na novação
  -- antiga (veículo + Termo) a entrada era a antecipação da fatura de transição.
  and n."contratoTermoId" is null;

\echo '== 2) Assinado por todos + cobrança no ar -> Aguardando pagamento inicial =='
update contratos_credito c
set status = 'AGUARDANDO_PAGAMENTO_INICIAL', "entradaCobrancaAsaasId" = coalesce(c."entradaCobrancaAsaasId", n."asaasChargeIdRecebimento"), "updatedAt" = now()
from novacoes n
where n."contratoVeiculoId" = c.id and n."deletedAt" is null
  and n.status = 'AGUARDANDO_RECEBIMENTO' and n."asaasChargeIdRecebimento" is not null
  and c.status = 'AGUARDANDO_ASSINATURA';

\echo '== DEPOIS =='
select c.numero, n.status as novacao, c.status as contrato, n."recebimentoInicial" as recebimento,
       n."dataAtivacao"::date as ativacao, c."entradaPagaEm"::date as entrada_paga_em,
       (select count(*) from lancamentos_conta l where l."contratoId" = c.id and l.tipo = 'ENTRADA_CONTRATO') as lancamentos_entrada
from novacoes n join contratos_credito c on c.id = n."contratoVeiculoId"
where n."deletedAt" is null and n.status in ('ATIVO', 'AGUARDANDO_RECEBIMENTO')
order by c.numero;
SQL
ok "Acerto aplicado em $STACK"
