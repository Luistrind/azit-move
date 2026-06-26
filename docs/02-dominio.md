# Especificação de Domínio V3 — Azit Move
**Motor de Crédito: Documento Técnico de Referência**
Versão: 1.0
Data: 2026-06-23

---

## 1. Visão Geral

A plataforma Azit Move é um **motor de crédito** que opera ativos próprios e de terceiros, gerencia contratos de parcelamento com reserva de domínio e presta contas para múltiplos stakeholders — cliente, time operacional, investidor de ativo específico e investidor de fundo.

O sistema é a **fonte única da verdade** da operação. O Asaas é a camada de execução de pagamentos. O PopHub é o sistema de originação de contratos. Toda lógica de negócio, cronogramas, status e rastreabilidade vivem neste sistema.

---

## 2. Princípios do Modelo

- **Asaas executa, Azit controla** — lógica de negócio nunca vive no Asaas.
- **O recebível nasce no dia zero** — cronograma completo gerado na criação do contrato.
- **A dívida existe independente do ativo** — sinistro, furto ou dano não extinguem a obrigação do cliente.
- **Toda cobrança tem um destino definido** — cada item cobrado tem um credor explícito.
- **A fatura é o agregador, o contrato é a origem** — a dívida nasce no contrato, é cobrada na fatura.
- **Novos produtos entram na próxima fatura** — fatura fechada é imutável.
- **O sistema é operado por humanos, não substituído por eles** — ações críticas são registradas por humanos, o sistema executa as consequências.
- **Encargo → Serviço → Principal** — ordem de imputação de pagamentos.

---

## 3. Hierarquia de Entidades

```
Titular (cadastro único — pessoa física ou jurídica, identificada por CPF/CNPJ)
└── Conta (relacionamento financeiro com a Azit)
    ├── ContratoCredito (o que o titular DEVE — financiamento, crédito avulso)
    │   ├── ItemContratado (produtos da cesta)
    │   ├── Parcela (cronograma de pagamento)
    │   ├── Fatura (cobrança semanal)
    │   │   └── ItemFatura (itens agregados na fatura)
    │   ├── Recebível (direito financeiro)
    │   └── Acordo (renegociação)
    └── ContratoInvestimento (o que a Azit DEVE ao titular — aporte)
        └── OrigemCapital (liga o aporte aos ativos/contratos que financia)

Ativo
└── vinculado a um ContratoCredito; financiado por uma OrigemCapital
```

**Princípio:** a Conta não tem "tipo". Um mesmo titular pode, na mesma conta, ter contratos de crédito (devendo) e contratos de investimento (recebendo). O que o titular acessa é consequência do que a conta possui — não de um atributo que a classifica. Cliente e Investidor são **papéis** que um titular exerce, não entidades de identidade separadas.

> Espelha a lógica bancária: existe um cadastro único de pessoa (CPF), uma conta/relacionamento, e produtos pendurados nela — crédito de um lado, investimento do outro, no mesmo extrato consolidado.

---

## 4. Entidades

---

### 4.1 Titular

Cadastro único de uma pessoa física ou jurídica que tem relacionamento financeiro com a Azit. É a entidade de identidade — existe antes de qualquer produto. "Cliente" e "Investidor" são papéis que um titular exerce (ter contrato de crédito / ter contrato de investimento), não entidades separadas.

**Campos:**
- `id` — identificador único
- `nome` — nome completo / razão social
- `tipo_pessoa` — pf | pj
- `cpf_cnpj` — documento principal (chave de identificação no Asaas)
- `rg` — documento secundário (PF)
- `estado_civil`
- `profissao`
- `whatsapp` — canal de comunicação oficial
- `email` — canal de comunicação oficial
- `endereco`, `bairro`, `cidade`, `estado`, `cep`
- `asaas_customer_id` — ID no Asaas
- `data_cadastro`
- `status` — ativo | inativo | bloqueado

**Relacionamentos:**
- tem uma `Conta`
- pode ser `IntervenienteGarantidor` de outro titular

> **Papéis:** um titular é "cliente" quando sua conta tem ContratoCredito; é "investidor" quando sua conta tem ContratoInvestimento. Pode ser os dois simultaneamente. O papel é derivado do que a conta possui, não armazenado como tipo.

---

### 4.2 IntervenienteGarantidor

Pessoa que assume responsabilidade solidária pelo cumprimento das obrigações de um titular. Presente em alguns contratos de crédito.

**Campos:**
- `id`
- `titular_id` — titular ao qual está vinculado
- `nome`
- `cpf`
- `rg`
- `whatsapp`
- `email`
- `endereco`, `bairro`, `cidade`, `estado`, `cep`

---

### 4.3 Conta

Relacionamento financeiro entre o titular e a Azit. É o ponto central da visão financeira consolidada. Não tem tipo — agrega tanto produtos de crédito quanto de investimento do mesmo titular.

**Campos:**
- `id`
- `titular_id`
- `data_abertura`
- `status` — ativa | suspensa | encerrada

**Responsabilidades:**
- Agrega todos os `ContratoCredito` do titular (o que ele deve)
- Agrega todos os `ContratoInvestimento` do titular (o que a Azit lhe deve)
- Consolida saldo devedor total (lado crédito) e capital/retorno (lado investimento)
- Expõe extrato unificado ao titular

> Um titular que financiou um veículo e também aporta no fundo tem **uma única conta** com um ContratoCredito e um ContratoInvestimento. O acesso a cada módulo (cliente / investidor) é determinado pela presença de cada tipo de contrato.

---

### 4.4 Ativo

O bem objeto do contrato — hoje predominantemente veículos.

**Campos:**
- `id`
- `tipo` — veiculo | outro
- `descricao` — ex: "Hyundai HB20S 2025"
- `marca`
- `modelo`
- `ano_fabricacao`
- `ano_modelo`
- `cor`
- `placa`
- `chassi` — identificador único do veículo
- `renavam`
- `origem` — locadora | particular | concessionaria
- `combustivel` — flex | gasolina | eletrico
- `quilometragem_entrada`
- `valor_aquisicao`
- `status` — disponivel | em_contrato | quitado | recuperado | sinistrado

**Relacionamentos:**
- tem uma `OrigemCapital`
- vinculado a um `ContratoCredito`

---

### 4.5 OrigemCapital

Define como o ativo foi financiado. Separa a camada do titular-cliente (contrato de crédito) da camada do capital que financia aquele ativo.

**Campos:**
- `id`
- `ativo_id`
- `tipo` — capital_proprio | emprestimo | investidor_ativo | fundo
- `contrato_investimento_id` — quando tipo = investidor_ativo ou fundo, o aporte que financia este ativo
- `valor_aportado`
- `taxa_retorno` — taxa acordada com o investidor (quando aplicável)
- `data_aporte`
- `status` — ativo | encerrado

> Quando o capital vem de um investidor, a OrigemCapital aponta para o `ContratoInvestimento` daquele titular-investidor. É o elo entre o dinheiro que entra (lado investimento) e o ativo que ele financia (lado crédito).

---

### 4.6 ContratoInvestimento

Instrumento contratual do aporte de um titular-investidor. É o espelho do ContratoCredito, com o fluxo financeiro invertido: o titular entrega capital e a Azit devolve com rendimento. Pendurado na Conta do titular, como qualquer produto.

**Campos:**
- `id`
- `numero` — identificador do contrato de investimento
- `conta_id` — conta do titular-investidor
- `modelo` — ativo_especifico | fundo_coletivo | fundo_exclusivo
- `valor_aportado` — capital total aportado
- `taxa_retorno` — remuneração acordada
- `data_aporte`
- `data_inicio`
- `data_vencimento` — quando aplicável (ex: fundo com carência)
- `capital_amortizado` — quanto do principal já retornou ao investidor
- `rendimento_acumulado` — rendimento realizado até o momento
- `status` — ativo | encerrado

**Relacionamentos:**
- pertence a uma `Conta`
- pode financiar um ou mais `Ativo` via `OrigemCapital`

> A entidade **Investidor** deixa de existir como cadastro separado. Os dados pessoais ficam no `Titular`; a relação de investimento é o `ContratoInvestimento`. Um titular é "investidor" simplesmente por ter um ou mais ContratoInvestimento na conta.

---

### 4.7 ContratoCredito

Representação do acordo comercial entre a Azit e o titular para um produto de crédito (financiamento do veículo, crédito avulso). É a origem jurídica e financeira da relação de dívida. O titular **deve**. Anteriormente chamado apenas "Contrato"; renomeado para distinguir do `ContratoInvestimento`.

**Campos:**
- `id`
- `numero` — formato: AAAAMMNNNN (ex: 2026040001)
- `conta_id`
- `ativo_id`
- `pophub_id` — referência de origem no PopHub
- `data_assinatura`
- `data_primeira_parcela`
- `valor_total` — valor total do contrato
- `valor_entrada`
- `saldo_devedor` — valor total menos entrada
- `numero_parcelas`
- `valor_parcela_inicial`
- `periodicidade` — semanal | quinzenal | mensal
- `indice_reajuste` — ipca
- `taxa_multa_atraso` — padrão: 2%
- `taxa_juros_atraso` — padrão: 1% ao mês pro-rata die
- `taxa_desconto_quitacao` — taxa diária para cálculo de valor presente
- `status` — ver seção 5.2
- `data_encerramento`
- `motivo_encerramento` — quitacao | rescisao | cancelamento
- `asaas_subscription_id` — referência no Asaas

**Relacionamentos:**
- pertence a uma `Conta`
- vinculado a um `Ativo`
- tem múltiplos `ItemContratado`
- tem múltiplas `Parcela`
- tem múltiplas `Fatura`
- pode ter múltiplos `Acordo`

---

### 4.8 TipoProduto

Catálogo de produtos disponíveis para contratação.

| Produto | Natureza | Credor Padrão | Observação |
|---|---|---|---|
| Parcelamento do veículo | parcelado | azit ou investidor | Produto âncora |
| Proteção veicular | recorrente | azit ou terceiro | Valor alterável sem impactar parcelas |
| Rastreador | recorrente | azit ou terceiro | Valor alterável sem impactar parcelas |
| Taxa de serviço | recorrente | azit | |
| Crédito avulso | parcelado | azit | Para manutenção, pneus, despesas, débitos |

---

### 4.9 ItemContratado

Cada produto da cesta vinculado ao contrato. É a origem rastreável de cada cobrança. Pode nascer de uma venda (produto contratado) ou de uma renegociação (crédito que substitui parcelas extintas — ver 7.7 e 8.3).

**Campos:**
- `id`
- `contrato_id`
- `tipo_produto_id`
- `descricao`
- `natureza` — recorrente | parcelado
- `origem` — venda | renegociacao
- `acordo_origem_id` — quando origem = renegociacao, o acordo que gerou este item
- `credor` — azit | investidor | terceiro
- `credor_id` — quando credor = investidor ou terceiro
- `valor`
- `numero_parcelas` — quando natureza = parcelado
- `periodicidade` — semanal | quinzenal | mensal
- `data_inicio`
- `data_fim` — quando natureza = recorrente, equivale ao encerramento do contrato
- `status` — ativo | encerrado | cancelado

> **Origem = renegociacao:** quando um acordo é efetivado, ele gera um ItemContratado próprio (tipo "Crédito de renegociação") com natureza parcelada. As novas parcelas do acordo pertencem a este item — não são parcelas soltas. Isso segue o modelo bancário de novação: a dívida antiga é extinta e um novo crédito nasce para substituí-la.

---

### 4.10 Parcela

Unidade do cronograma de pagamento. Nasce no dia zero do contrato para todos os vencimentos futuros.

**Campos:**
- `id`
- `contrato_id`
- `item_contratado_id`
- `numero` — posição no cronograma (ex: 14)
- `total_parcelas` — total do conjunto (ex: 157)
- `display` — formato de exibição: "14/157"
- `valor_nominal` — valor original sem encargos
- `data_vencimento`
- `data_pagamento` — preenchido quando paga
- `valor_pago`
- `valor_encargo` — multa + juros aplicados no pagamento
- `status` — ver seção 5.1
- `fatura_id` — fatura onde esta parcela foi cobrada
- `acordo_id` — quando status = renegociada

---

### 4.11 Fatura

Cobrança periódica que agrega os itens vencidos de todos os contratos ativos do cliente. Existe desde a criação do contrato.

**Campos:**
- `id`
- `conta_id`
- `numero` — sequencial por conta
- `periodo_referencia` — data de referência do ciclo
- `data_fechamento` — D-5 antes do vencimento
- `data_vencimento`
- `data_pagamento`
- `valor_total` — soma dos itens
- `valor_pago`
- `status` — ver seção 5.3
- `asaas_charge_id` — ID da cobrança gerada no Asaas

**Relacionamentos:**
- tem múltiplos `ItemFatura`
- pode estar vinculada a um `Acordo`

---

### 4.12 ItemFatura

Cada item agregado dentro de uma fatura. É o vínculo entre a fatura e sua origem contratual.

**Campos:**
- `id`
- `fatura_id`
- `parcela_id` — origem da cobrança
- `tipo` — principal | servico | encargo
- `descricao`
- `valor`
- `credor` — azit | investidor | terceiro
- `credor_id`

---

### 4.13 Recebível

Direito financeiro gerado pelo contrato. Nasce no dia zero. Representa o que o sistema espera receber e o que efetivamente recebeu.

**Campos:**
- `id`
- `contrato_id`
- `parcela_id`
- `origem_capital_id`
- `data_prevista`
- `valor_previsto`
- `data_realizada`
- `valor_realizado`
- `status` — esperado | realizado | renegociado | cancelado
- `breakdown_capital` — valor de amortização de capital (a definir — ver placeholder)
- `breakdown_rendimento` — valor de rendimento do investidor (a definir)
- `breakdown_taxa_servico` — valor da taxa de serviço da Azit (a definir)

---

### 4.14 Acordo

Registro formal de uma renegociação. Tem ciclo de vida próprio e é a entidade onde vive o histórico do acordo — não no contrato.

**Campos:**
- `id`
- `contrato_id`
- `operador_id` — quem registrou o acordo
- `data_criacao`
- `data_efetivacao`
- `valor_total_renegociado` — soma das obrigações cobertas
- `valor_entrada` — entrada exigida para efetivação
- `numero_parcelas_novas`
- `valor_parcela_nova`
- `asaas_charge_id_entrada` — cobrança da entrada no Asaas
- `status` — rascunho | ativo | quitado | cancelado
- `observacao`

**Relacionamentos:**
- vinculado a um `ContratoCredito`
- referencia as `Parcela` cobertas (renegociadas)
- gera novas `Parcela`

---

### 4.15 ReajusteIPCA

Evento de reajuste anual das parcelas por IPCA. Precisa de aprovação humana antes de ser aplicado.

**Campos:**
- `id`
- `contrato_id`
- `data_aniversario` — data de referência do reajuste
- `indice_aplicado` — variação IPCA acumulada dos últimos 12 meses
- `valor_parcela_anterior`
- `valor_parcela_novo`
- `status` — pendente | aprovado | aplicado | cancelado
- `aprovado_por`
- `data_aprovacao`
- `data_aplicacao`
- `data_notificacao_cliente`

---

## 5. Status e Ciclos de Vida

---

### 5.1 Status da Parcela

| Status | Descrição | Tipo |
|---|---|---|
| Em aberto | Dentro do prazo, não paga | Calculado |
| Vence hoje | Vencimento na data atual | Calculado |
| Vencida | Passou do vencimento, não paga | Calculado |
| Paga | Quitada no prazo | Armazenado |
| Paga em atraso | Quitada após o vencimento | Armazenado |
| Paga antecipada | Quitada antes do vencimento | Armazenado |
| Renegociada | Coberta por acordo de renegociação — permanente | Armazenado |
| Cancelada | Anulada por erro, distrato ou decisão administrativa | Armazenado |
| Estornada | Baixa de pagamento revertida | Armazenado |
| Suspensa | Pausada temporariamente por situação especial | Armazenado |

> **Nota:** Status calculados (Em aberto, Vence hoje, Vencida) não são armazenados no banco — são derivados da comparação entre `data_vencimento` e a data atual. Os demais são armazenados.

---

### 5.2 Status do ContratoCredito

**Pré-ativação:**
| Status | Descrição |
|---|---|
| Rascunho | Criado, incompleto, não enviado |
| Aguardando assinatura | Enviado, não assinado |
| Aguardando pagamento inicial | Depende de entrada ou primeira parcela |
| Aguardando entrega do veículo | Assinado, veículo não entregue |

**Em vigor:**
| Status | Descrição |
|---|---|
| Ativo | Em dia, parcelas em andamento |
| Inadimplente | Uma ou mais parcelas vencidas |
| Bloqueado | Veículo bloqueado por inadimplência ou regra operacional |
| Suspenso | Pausado temporariamente por situação especial |
| Em recuperação de veículo | Processo de retomada do veículo em andamento |

**Encerramento:**
| Status | Descrição |
|---|---|
| Cancelado | Encerrado antes da ativação ou por erro/distrato |
| Rescindido | Encerrado por inadimplência grave após retomada do veículo |
| Quitado (aguardando transferência) | Obrigações pagas, transferência do ativo pendente |
| Quitado (transferência efetivada) | Obrigações pagas e ativo transferido ao cliente |

> **Nota:** O contrato não tem status "Renegociado". A renegociação é um evento registrado no `Acordo`. O contrato volta para Ativo quando todas as obrigações estão pagas ou cobertas por acordo.

---

### 5.3 Status da Fatura

| Status | Descrição |
|---|---|
| Aberta | Recebendo itens, pré-fechamento |
| Fechada | Consolidada, cobrança gerada no Asaas, aguardando vencimento |
| Vencida | Passou do vencimento sem pagamento integral |
| Paga | Quitada integralmente no vencimento |
| Paga em atraso | Quitada integralmente após o vencimento |
| Renegociada | Coberta por acordo de renegociação — permanente |

---

### 5.4 Status do Acordo

| Status | Descrição |
|---|---|
| Rascunho | Acordo estruturado, aguardando pagamento da entrada |
| Ativo | Entrada paga, renegociação efetivada |
| Quitado | Todas as parcelas do acordo foram pagas |
| Cancelado | Acordo cancelado antes da efetivação |

---

## 6. Mapa de Gatilhos

### Gatilho 1 — Fatura vence sem pagamento
- Fatura: Fechada → **Vencida**
- Parcelas vinculadas: Em aberto/Vence hoje → **Vencida** *(calculado)*
- Contrato: Ativo → **Inadimplente**

### Gatilho 2 — Pagamento confirmado via webhook (no prazo)
- Fatura: Fechada → **Paga**
- Parcelas vinculadas: Em aberto/Vence hoje → **Paga**
- Contrato: permanece **Ativo**

### Gatilho 3 — Pagamento confirmado via webhook (após vencimento)
- Fatura: Vencida → **Paga em atraso**
- Parcelas vinculadas: Vencida → **Paga em atraso**
- Contrato: Inadimplente → **Ativo** *(somente se não houver outras faturas vencidas)*

### Gatilho 4 — D+3 sem pagamento
- Fatura: permanece **Vencida**
- Parcelas: permanecem **Vencidas**
- Contrato: Inadimplente → **Bloqueado**
- Ação: bloqueio remoto do veículo (manual via sistema)

### Gatilho 5 — Operador registra renegociação
- Acordo: nasce em **Rascunho**
- Fatura: permanece em estado atual *(ainda não mudou)*
- Parcelas: permanecem em estado atual
- Contrato: permanece em estado atual
- Ação: sistema gera cobrança da entrada no Asaas

### Gatilho 6 — Entrada da renegociação confirmada via webhook
- Acordo: Rascunho → **Ativo**
- Faturas cobertas: Vencida → **Renegociada** *(permanente)*
- Parcelas cobertas: Vencida → **Renegociada** *(permanente)*
- Novas parcelas: nascem com status **Em aberto**
- Contrato: Inadimplente/Bloqueado → **Ativo** *(se todas obrigações cobertas)*

### Gatilho 7 — Quitação antecipada de parcelas específicas confirmada
- Parcelas selecionadas: Em aberto → **Paga antecipada**
- Fatura correspondente: atualizada com as baixas

### Gatilho 8 — Quitação total confirmada
- Todas as parcelas restantes: Em aberto → **Paga antecipada**
- Contrato: Ativo → **Quitado (aguardando transferência)**
- Ativo: em_contrato → **quitado**

### Gatilho 9 — Transferência do ativo efetivada
- Contrato: Quitado (aguardando transferência) → **Quitado (transferência efetivada)**

### Gatilho 10 — Reajuste IPCA aprovado pelo operador
- ReajusteIPCA: Pendente → **Aprovado**
- Parcelas futuras: valor atualizado com novo índice
- Faturas futuras abertas: valor atualizado
- Ação: cliente notificado com 30 dias de antecedência

### Gatilho 11 — Sinistro registrado
- Seguro acionado (ação externa)
- Indenização recebida: amortiza saldo devedor via pagamento parcial
- Se saldo zerado: Contrato → **Quitado (aguardando transferência)**
- Se saldo remanescente: Contrato permanece **Ativo**, cliente responsável pelo saldo

---

## 7. Regras de Negócio

### 7.1 Fechamento de Fatura
- Faturas existem desde a criação do contrato
- Fechamento ocorre em **D-5** antes do vencimento
- Após o fechamento, nenhum item novo entra na fatura
- Novos contratos ou produtos contratados após o fechamento entram na próxima fatura aberta
- No fechamento: sistema gera cobrança no Asaas

### 7.2 Penalidades por Atraso
- Multa moratória: **2%** sobre o valor em atraso (aplicada uma vez)
- Juros: **1% ao mês**, calculados pro-rata die a partir do vencimento
- Cálculo: `encargo = valor * 0.02 + valor * (0.01/30) * dias_atraso`
- O Asaas calcula e aplica automaticamente no momento do pagamento
- O sistema recalcula internamente para conciliação e breakdown

### 7.3 Ordem de Imputação do Pagamento
Quando o valor pago é insuficiente para cobrir todos os itens, a aplicação segue:
1. **Encargo** — multa e juros de atraso
2. **Serviço** — itens recorrentes (proteção, rastreador, taxa)
3. **Principal** — amortização do parcelamento do veículo

### 7.4 Fórmula de Quitação Antecipada
```
VP = VF / (1 + taxa)^tempo
```
Onde:
- `VP` = valor presente (o que o cliente paga)
- `VF` = valor futuro (valor nominal da parcela)
- `taxa` = taxa diária de desconto (parametrizável por contrato)
- `tempo` = número de dias entre a data de consulta/pagamento e a data de vencimento da parcela

A fórmula é aplicada parcela a parcela. O valor de quitação total é a soma dos VP de todas as parcelas restantes.

**Modalidades de quitação antecipada:**
1. **Parcelas específicas** — cliente seleciona uma ou mais parcelas futuras; sistema calcula VP de cada uma
2. **Quitação total** — sistema calcula VP de todas as parcelas restantes
3. **Encerramento de contrato** — quitação total + registro de transferência do ativo

### 7.5 Reajuste Anual por IPCA
- Ocorre no aniversário do contrato (12 meses após a assinatura)
- Índice: variação acumulada do IPCA dos últimos 12 meses
- Fluxo: sistema gera evento → operador revisa e aprova → sistema atualiza parcelas futuras → cliente notificado com 30 dias de antecedência
- Se o IPCA deixar de ser divulgado, utilizar índice oficial substituto

### 7.6 Régua de Cobrança
| Dia | Ação | Tipo |
|---|---|---|
| D+0 | Fatura vence, Asaas registra inadimplência | Automático |
| D+1 | Bot inicia cobrança via WhatsApp | Automático |
| D+2 | Segunda tentativa de cobrança via bot | Automático |
| D+3 | Bloqueio remoto do veículo | Manual (registrado no sistema) |
| D+10 | Notificação extrajudicial | Manual |
| D+12 | Início do processo de recuperação do veículo | Manual |

> Desbloqueio após pagamento é sempre **manual** — o operador confirma a regularização antes de liberar.

### 7.7 Renegociação
- Operador seleciona obrigações em aberto por item (parcela) ou por fatura
- Sistema soma o saldo e permite estruturar novo acordo
- Acordo nasce em **Rascunho** — não tem efeito até pagamento da entrada
- Pagamento da entrada via webhook do Asaas é o aceite formal do cliente
- Após confirmação (novação):
  - Faturas e parcelas originais → **Renegociadas** (permanente)
  - O acordo gera um `ItemContratado` de origem **renegociacao**
  - As novas parcelas pertencem a esse item e nascem Em aberto
- Novas parcelas entram na próxima fatura aberta
- Renegociações passam pela estrutura de alçadas de aprovação

### 7.8 Tratamento de Sinistro
- A dívida do cliente não é automaticamente perdoada em caso de sinistro, furto, roubo ou perda total
- O cliente permanece responsável pelo saldo devedor
- A Azit deve constar como beneficiária do seguro obrigatório previsto em contrato
- Indenização recebida: amortiza o saldo devedor (não quita automaticamente)
- Sobra após amortização: pertence ao cliente
- Saldo remanescente após indenização: continua obrigação do cliente

### 7.9 Alçadas de Aprovação
Estrutura transversal aplicável a:
- Renegociações
- Repactuações radicais
- Financiamento de despesas de clientes
- Reajuste IPCA
- Venda de produtos e crédito avulso
- Qualquer operação com parcelamento, risco ou exceção

> ⚠️ **Placeholder:** Regras específicas de alçada (quem aprova o quê, limites de valor) a definir com Vicente. A estrutura deve ser configurável — não hardcoded.

---

## 8. Fluxos Principais

### 8.1 Originação de ContratoCredito
1. Contrato e dados do titular chegam via API do PopHub no momento da assinatura
2. Sistema identifica o ativo correspondente e vincula automaticamente
3. Sistema cria ou identifica o `Titular` (pelo CPF/CNPJ) e sua `Conta`
4. Entrada já foi paga no PopHub/Asaas — sistema concilia e registra
5. Sistema gera cronograma completo de `Parcela` a partir do saldo devedor pós-entrada
6. Sistema cria `Fatura` futuras com itens previstos
7. Sistema cria `Recebível` para cada parcela
8. ContratoCredito entra em status **Ativo**

### 8.2 Ciclo Semanal de Fatura
1. Faturas existem desde a originação com status **Aberta**
2. Em D-5: fatura **fecha** — nenhum item novo entra
3. Sistema gera cobrança no Asaas → `asaas_charge_id` registrado na fatura
4. Fatura: Aberta → **Fechada**
5. No dia do vencimento: cliente notificado via WhatsApp com valor e link
6. Pagamento confirmado via webhook → sistema concilia → baixa na fatura e parcelas → breakdown de recebíveis calculado
7. Sem pagamento → fatura → **Vencida** → régua de cobrança ativada

### 8.3 Renegociação
1. Operador acessa módulo de renegociação e seleciona obrigações em aberto
2. Sistema soma o saldo total
3. Operador estrutura o acordo (valor entrada, número de parcelas, valor da parcela)
4. Acordo passa pela estrutura de alçadas
5. Após aprovação: sistema cria `Acordo` em **Rascunho** e gera cobrança da entrada no Asaas
6. Cliente paga a entrada → webhook confirma
7. Sistema efetiva a renegociação (novação):
   - `Acordo`: Rascunho → **Ativo**
   - Faturas/parcelas cobertas → **Renegociadas** (permanente)
   - Sistema cria um `ItemContratado` de origem **renegociacao**, vinculado ao acordo
   - Novas parcelas nascem vinculadas a esse item, com numeração própria (1/12, 2/12...), e entram na próxima fatura aberta

### 8.4 Quitação Antecipada
1. Operador ou cliente solicita simulação de quitação
2. Sistema aplica fórmula `VP = VF / (1 + taxa)^tempo` para cada parcela selecionada
3. Sistema apresenta o valor calculado
4. Pagamento confirmado via webhook
5. Parcelas quitadas → **Paga antecipada**
6. Se quitação total → Contrato → **Quitado (aguardando transferência)**

### 8.5 Sinistro
1. Sinistro registrado no sistema pelo operador
2. Seguro acionado externamente
3. Indenização recebida registrada no sistema
4. Sistema aplica indenização como amortização do saldo devedor
5. Se saldo zerado → Contrato → **Quitado**
6. Se saldo remanescente → Contrato permanece **Ativo**, cliente notificado do saldo

---

## 9. Catálogo de Produtos

| Produto | Natureza | Credor | Credor Alternativo |
|---|---|---|---|
| Parcelamento do veículo | Parcelado | Azit | Investidor |
| Proteção veicular | Recorrente | Azit | Terceiro |
| Rastreador | Recorrente | Azit | Terceiro |
| Taxa de serviço | Recorrente | Azit | — |
| Crédito avulso | Parcelado | Azit | — |

---

## 10. Modelos de Capital

| Tipo | Descrição | Retorno |
|---|---|---|
| Capital próprio | Azit compra o ativo com caixa próprio | 100% para a Azit |
| Empréstimo | Azit toma crédito para comprar | Retorno do contrato cobre custo do empréstimo + margem |
| Investidor de ativo específico | Investidor financia veículo específico; Azit administra | Breakdown: amortização + rendimento para investidor, taxa de serviço para Azit |
| Fundo | Investidor aporta em pool de contratos | Retorno consolidado do portfólio, repassado mensalmente |

> O contrato do cliente é sempre idêntico, independente do modelo de capital. A origem do capital é transparente para o cliente.

---

## 11. Integrações

### 11.1 PopHub (Entrada)
- **Direção:** PopHub → Azit Move
- **Gatilho:** assinatura do contrato
- **Dados recebidos:** contrato completo + dados do cliente + identificação do ativo
- **Formato:** API REST (payload a especificar no Doc 2)

### 11.2 Asaas (Execução de Pagamentos)
- **Direção:** bidirecional
- **Azit → Asaas:** criação de cobranças (avulsas, nunca assinaturas)
- **Asaas → Azit:** webhooks de confirmação de pagamento
- **Regra:** uma cobrança ativa por contrato por vez, gerada em D-5
- **Juros/multas:** calculados automaticamente pelo Asaas no momento do pagamento; sistema recalcula internamente para conciliação

### 11.3 WhatsApp / Z-API (Comunicação)
- **Direção:** Azit → Cliente
- **Uso:** notificação de vencimento, cobrança na régua, comunicados operacionais

---

## 12. Placeholders — A Definir

| Item | Descrição | Responsável |
|---|---|---|
| Fórmula de breakdown do recebível | Como calcular exatamente a divisão entre amortização de capital, rendimento do investidor e taxa de serviço por pagamento | Vicente / Sebastião (depende da estrutura jurídica do fundo) |
| Regras de alçadas de aprovação | Quem aprova o quê, limites de valor por tipo de operação e perfil de usuário | Vicente |
| Aceite rápido para novos itens | Fluxo detalhado do mecanismo de aceite do cliente para novos produtos/despesas financiadas | Vicente / Luís |
| Regra de split em atraso >30 dias | Como distribuir juros e multas entre operação e investidor em atrasos prolongados | Vicente |
| Estrutura jurídica do fundo | Modelo legal para repasse ao investidor pessoa física | Sebastião |
| Visão do investidor | Fluxos e interface de acompanhamento de performance para investidores | Stand-by |
| Oferta ao investidor | Produto de capital protegido/garantido, fundo de reserva, mecanismos de proteção | Vicente |

---

*Documento vivo — atualizar a cada decisão validada com Vicente.*
*Versão 1.0 — 2026-06-23*
