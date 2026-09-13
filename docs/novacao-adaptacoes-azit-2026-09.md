# Novação de Contrato — Adaptações da Azit ao Produto V1.0

**Vinculado a:** `Produto Novacao de Contrato v1.0 - Azit Hub.pdf` (Vicente, 26/08/2026) e
`Planilha Novacao de Contrato - Azit Move.xlsx` (fonte das fórmulas).

**Natureza deste documento:** o V1.0 do Vicente vale como base do produto — é rico e a maior
parte das regras é legítima (parâmetros, motor de liquidação por componente, invariantes,
estados, CONAC, assinatura, ativação atômica). Este documento registra **o que a Azit aplica
diferente**, por adaptação de contexto ou melhoria, decidido por Luís em 13/09/2026. Na
revisão do produto (V1.1), estas adaptações devem ser incorporadas ou contestadas — nunca
ignoradas.

---

## A1. A unidade da novação é a FATURA, não o contrato

O V1.0 pensa a novação por contrato — o modelo de um banco, dono de todos os produtos que
vende. Na Azit, **todos os contratos fecham na fatura**: uma fatura carrega a parcela do
veículo, o seguro, o reembolso parcelado e parcelas de renegociações anteriores, e **cada
produto pertence a uma estrutura jurídica diferente**. O que existe de dívida real são as
faturas em aberto — cada uma um mix de produtos. A novação parte, portanto, do **saldo das
faturas decomposto por produto**, não da liquidação de contratos isolados.

## A2. Dois contratos novos, assinados juntos — e SEM cessão interentidades

O V1.0 resolve o multi-credor com cessão/transferência de créditos entre entidades antes da
ativação (Seção 12; pendências PEND-NV-06/07). Na Azit isso não é necessário, porque fora o
veículo **todo o resto já é economicamente crédito da Azit**: a Azit paga a seguradora
independentemente de o cliente pagar a fatura, e paga o fornecedor do reembolso à vista. As
estruturas de produto são camada de **apropriação interna**, não credores do cliente.

A novação gera **dois contratos, assinados no mesmo ato (mesmo envelope)**:

| | Contrato 1 — Novação do veículo | Contrato 2 — Regularização dos demais produtos |
|---|---|---|
| Composição | Saldo em atraso da PARTE DO VEÍCULO (decomposto das faturas e dos acordos anteriores) + condições do novo financiamento (upgrade, downgrade ou reestruturação) | Reembolso parcelado + atrasados de seguro + parte não-veículo de renegociações anteriores |
| Credor | Estrutura jurídica dona do ativo (investidor) | Azit Move |
| Papel no cálculo | **É o insumo do motor da novação** — o contrato novo do veículo nasce com a mesma estrutura de um contrato feito do zero (o saldo em atraso compõe o cálculo, como no V1.0) | **NÃO é saldo de novação — é outra coisa**: instrumento separado da dívida com a Azit |
| Isolamento | Reserva de domínio, garantia e recebível do investidor | Rastreabilidade por produto preservada nos itens/snapshot (split interno entre estruturas é apropriação contábil, invisível ao cliente) |

> **Aberto (A2.a):** regras financeiras do Contrato 2 — parcelamento simples, com encargos
> próprios, ou com as regras de outro produto? (ver pergunta em aberto ao Luís).
> **Aberto (A2.b):** nome de domínio do Contrato 2 (vocabulário: um conceito = um nome).

## A3. Seguro não é novado — o serviço continua

O contrato de seguro/proteção **segue vivo normalmente** (é serviço; a Azit o paga de
qualquer forma). Somente o **atrasado** de seguro entra — no Contrato 2. Contribuições
futuras nunca entram em saldo (o V1.0 já isentava vincendos; a adaptação é que **nem novo
contrato de proteção é necessário** — não há o que recriar, o contrato continua). Casos de
troca de veículo seguem a regra do produto Proteção (nova adesão para o ativo novo).

## A4. Comissão não é componente de dívida do cliente

O V1.0 (e a planilha) tratam "comissão vencida" como componente separado do valor de
liquidação. Na Azit a comissão é **interna à precificação da parcela** (split Azit ↔
investidor, decisão 04/07: CI/CR não viram item de contrato): o cliente deve a **parcela
cheia** e nunca vê comissão. Na decomposição do saldo, o componente "comissão" do V1.0 **não
se aplica** — a dívida do veículo é a parcela. Para o futuro, o contrato novado do veículo
nasce como contrato novo normal (comissão embutida na precificação, assunto Azit ↔
investidor).

## A5. Decomposição dos acordos anteriores — juros rateados em PARTES IGUAIS

Renegociações anteriores são linhas "misturadas": o acordo cobriu faturas que continham
vários produtos e virou parcelas únicas com encargos embutidos. Para novar, o sistema
**explode o acordo pelos snapshots**: reconstitui a composição original por produto → aplica
os pagamentos já imputados → **rateia os juros/encargos do acordo em PARTES IGUAIS entre os
produtos** da composição (decisão Luís 13/09) → apura o saldo devido por produto. A parte
veículo vai ao Contrato 1; o resto, ao Contrato 2.

## A6. Entrada e motivos

Novação normalmente **não tem entrada** (diferente da originação). Os motivos são variados —
upgrade, downgrade ou reestruturação — e mudam o **ajuste de ativos** (troca do veículo,
valor de transação), não a mecânica do cálculo.

## O que permanece do V1.0 (sem adaptação)

- CONAC em 100% das operações; parecer único do operador com memória de cálculo.
- Instrumentos formais + assinatura eletrônica obrigatória; validade assinatura→ativação de
  5 dias; ativação atômica condicionada ao recebimento inicial; snapshot imutável.
- Motor de liquidação por componente: vencidos com multa 2% + juros 1% a.m. pró-rata;
  vincendos elegíveis a valor presente pela taxa do produto de ORIGEM.
- Desconto somente via CONAC, rateado nos saldos elegíveis; ajuste de ativos manual com
  memória; análise de crédito quando a exposição aumenta.
- Estados do processo (14.1), invariantes (RNV001–045 no que não conflitar com A1–A6) e
  pendências PEND-NV-01..10 (não resolvidas por inferência).
