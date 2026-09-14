# Novação de Contrato — Adaptações da Azit ao Produto V1.0

**Vinculado a:** `Produto Novacao de Contrato v1.0 - Azit Hub.pdf` (Vicente, 26/08/2026) e
`Planilha Novacao de Contrato - Azit Move.xlsx` (fonte das fórmulas).

**Natureza deste documento:** o V1.0 do Vicente vale como base do produto — é rico e a maior
parte das regras é legítima (parâmetros, motor de liquidação por componente, invariantes,
estados, CONAC, assinatura, ativação atômica). Este documento registra **o que a Azit aplica
diferente**, por adaptação de contexto ou melhoria (decisões de Luís, 13/09/2026), e
consolida a **regra de negócio do cálculo** na forma final. Na revisão do produto (V1.1),
estas adaptações devem ser incorporadas ou contestadas — nunca ignoradas.

---

## A1. A unidade da novação é a FATURA, não o contrato

O V1.0 pensa a novação por contrato — o modelo de um banco, dono de todos os produtos que
vende. Na Azit, **todos os contratos fecham na fatura**: uma fatura carrega a parcela do
veículo, o seguro, o reembolso parcelado e parcelas de renegociações anteriores, e **cada
produto pertence a uma estrutura jurídica diferente**. O que existe de dívida real são as
faturas em aberto — cada uma um mix de produtos. A novação parte do **saldo das faturas
decomposto por produto**.

## A2. Dois contratos novos, assinados juntos — e SEM cessão interentidades

Fora o veículo, **todo o resto já é economicamente crédito da Azit**: a Azit paga a
seguradora independentemente de o cliente pagar a fatura, e paga o fornecedor do reembolso à
vista. As estruturas de produto são camada de **apropriação interna**, não credores do
cliente. Por isso a cessão/transferência interentidades do V1.0 (Seção 12) não é necessária.

A novação gera **dois contratos, assinados no mesmo ato (mesmo envelope)**:

- **Contrato 1 — Novação do veículo.** Credor: estrutura jurídica dona do ativo
  (investidor). O saldo apurado da parte do veículo **compõe o cálculo do novo contrato**,
  que nasce com a mesma estrutura de um contrato feito do zero. Isola a reserva de domínio,
  a garantia e o recebível do investidor.
- **Contrato 2 — Termo de Regularização de Débitos** (nome provisório em uso desde 13/09;
  batismo definitivo pendente com o jurídico).
  Credor: Azit Move. Reembolso parcelado + seguro vencido + parte não-veículo de
  renegociações anteriores. **Não é saldo de novação — é outra coisa**: instrumento separado
  da dívida com a Azit, sem garantia vinculada. A rastreabilidade por produto fica nos
  itens/snapshot; o split interno entre estruturas é apropriação contábil, invisível ao
  cliente.

> **Ponto para o Jurídico:** como a alavanca de retomada vive só no Contrato 1, prever
> cláusula de inadimplência cruzada entre os dois contratos (o não-pagamento do Contrato 2
> configura inadimplência do conjunto). Forma a homologar.

## A3. Seguro não é novado — o serviço continua

O contrato de seguro/proteção **segue vivo normalmente**. Somente o **vencido** de seguro
entra (no Contrato 2). Contribuições futuras nunca entram em saldo, e **não é preciso criar
novo contrato de proteção** — o existente continua. Troca de veículo segue a regra do
produto Proteção (nova adesão para o ativo novo).

## A4. Comissão não é componente de dívida do cliente

A comissão é **interna à precificação da parcela** (split Azit ↔ investidor; decisão 04/07:
CI/CR não viram item de contrato). O cliente deve a **parcela cheia** e nunca vê comissão.
O componente "comissão" do V1.0 não se aplica na decomposição do saldo. No contrato novado
do veículo, a comissão segue embutida na precificação, como em qualquer contrato novo.

## A5. Troca de veículo: valor vem do CADASTRO (tabela FIPE), não é informado livre

Quando a novação propõe troca de veículo (não obrigatória): o veículo novo deve estar
**disponível no Estoque de Ativos** (o novo contrato precisa dos dados do veículo), e o
valor de referência de cada veículo é **o valor de cadastro (tabela FIPE) do ativo** — não
um valor meramente informado pelo operador. O ajuste econômico da operação deriva desses
valores de cadastro (veículo que entra menos veículo que sai), com memória no parecer.

## A6. Sequenciamento: o Contrato 2 é pago PRIMEIRO

O Contrato 2 não tem garantia; o cliente poderia pagar só o contrato do veículo e nunca o
saldo antigo. Por isso:

1. **A parcela do Contrato 2 tem o mesmo valor da parcela calculada para o contrato do
   veículo** — o cliente sente um único valor periódico do início ao fim.
2. **As parcelas do Contrato 2 ocupam as primeiras faturas do relacionamento novo**; o
   cronograma do veículo começa em seguida. A dívida sem garantia nunca é diluída no prazo
   do contrato de compra e venda.
3. **Fatura de transição:** a última parcela do Contrato 2 dificilmente fecha no valor
   padrão; para a fatura não sair "muito barata", ela é completada com uma **antecipação do
   contrato do veículo** (o resto do Contrato 2 + amortização antecipada do veículo somam o
   valor periódico padrão; a antecipação abate o saldo do veículo antes do cronograma dele
   começar).
4. **Durante a fase do Contrato 2, os repasses do investidor e as comissões da Azit sobre a
   administração do bem ficam CONGELADOS** — o saldo do veículo não rende juros nesse
   período; a prioridade é quitar o saldo anterior deixado.

## A7. Regra de negócio consolidada — o cálculo da novação (sem abreviações)

**Passo 1 — Levantamento e decomposição do saldo (a base é a fatura).**
Para cada fatura em aberto da conta, o sistema decompõe os itens por produto: parcela do
veículo, seguro, reembolso parcelado, parcela de renegociação anterior. Itens de
renegociação são explodidos pelo snapshot do acordo: reconstitui-se a composição original
por produto, abatem-se os pagamentos já feitos, e **os juros e encargos do acordo são
divididos em partes iguais entre os produtos** da composição. Componentes **vencidos**
entram pelo saldo em aberto **mais multa de 2% mais juros de mora de 1% ao mês**,
proporcionais aos dias de atraso na base de 30 dias. **Todo o saldo futuro do veículo
entra** — a novação extingue a obrigação inteira: as parcelas a vencer do veículo são
trazidas a **valor presente pela taxa do contrato de origem**, conforme o V1.0. A única
exceção de futuro é o **seguro** (só o vencido entra; o contrato de seguro continua).
**Comissão não entra** — não é dívida do cliente.

**Passo 2 — Separação em duas composições.**
O saldo apurado da **parte do veículo** (vencidos + futuros a valor presente) compõe o
cálculo da novação (Contrato 1). O saldo dos **demais produtos** — reembolso, seguro vencido
e a parte não-veículo das renegociações — vira o Contrato 2.

**Passo 3 — Contrato 1: a novação do veículo (nasce como um contrato feito do zero).**
Saldo do veículo **mais o ajuste da troca de veículo, quando houver** (valores de cadastro —
tabela FIPE — do veículo que entra menos o do que sai; o veículo novo precisa estar
disponível no Estoque de Ativos) forma o **saldo-base**. Desconto, **somente com aprovação
do comitê**, reduz o saldo-base e chega-se ao **saldo novado**. A **taxa inicial de
processamento** — o maior entre 2% do saldo-base e R$ 3.990 — incide **uma única vez sobre a
operação** e é alocada neste contrato. Se houver recebimento inicial, o mínimo é o maior
entre 1% do saldo novado e a taxa inicial de processamento; a taxa é apropriada primeiro, e
o que sobrar amortiza o saldo. O restante é parcelado pela **Tabela Price à taxa de 1,70% ao
mês**, convertida à frequência escolhida por equivalência composta (elevando ao número de
dias da frequência dividido por 30), com prazo máximo de 60 meses e diferença de
arredondamento ajustada na última parcela.

**Passo 4 — Contrato 2: a regularização dos demais produtos (paga-se primeiro).**
O saldo dos demais produtos também é financiado à **taxa de 1,70% ao mês**. O valor da
parcela é **o mesmo valor periódico do contrato do veículo**; a quantidade de parcelas é a
necessária para quitar o saldo com juros. As parcelas do Contrato 2 ocupam as **primeiras
faturas**; na **fatura de transição**, o resto do Contrato 2 é completado com uma
**antecipação do contrato do veículo** até o valor periódico padrão (a antecipação abate o
saldo do veículo). O cronograma do veículo começa em seguida. **Durante a fase do Contrato
2, repasses do investidor e comissões da Azit sobre o bem ficam congelados** — o saldo do
veículo não rende juros nesse período.

**Passo 5 — A fatura do cliente.**
Em cada período, a fatura carrega: a parcela vigente **mais** a contribuição do seguro
(contrato que continua) **mais** eventuais acessórios. O cliente vê um valor periódico
estável do começo ao fim.

**Passo 6 — Governança e ativação.**
Toda novação passa pelo comitê (CONAC); aumento de exposição exige análise de crédito antes;
os **dois contratos são assinados juntos, no mesmo ato**; o recebimento inicial (quando
houver) condiciona a ativação, com prazo máximo de 5 dias entre assinatura e ativação; a
ativação é **atômica** — marca as obrigações de origem como novadas, gera os dois
cronogramas na ordem descrita e nada fica pela metade.

## Abertos

- **Nome de domínio do Contrato 2**: em uso o provisório "Termo de Regularização de
  Débitos" (decisão Luís 13/09 — "deixo sua solução por enquanto"); batismo definitivo
  com o jurídico (vocabulário: um conceito = um nome).
- Forma jurídica da cláusula de inadimplência cruzada (Jurídico).
- Pendências PEND-NV-01..10 do V1.0 no que ainda se aplicarem (não resolver por inferência).

## Construção (fases)

- **F1 — CONSTRUÍDA (13/09):** motor de decomposição do saldo por produto (A7 passos 1–2)
  em `@azit/utils` (`novacao.ts`, testes unitários), montador no backend
  (`novacao-decomposicao.service.ts`), endpoint `GET /contas/:id/novacao/decomposicao` e
  prévia na ficha do titular (Contrato 1 × Contrato 2, memória de cálculo auditável).
- F0/F2: produto `novacao` no Catálogo; simulação e proposta (taxa inicial de
  processamento, desconto CONAC, Price 1,70%, sequenciamento A6), dois instrumentos
  assinados juntos, recebimento inicial, ativação atômica.
- F3: ativos, garantias e troca de veículo (A5).
