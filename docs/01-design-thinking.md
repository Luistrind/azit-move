# Design Thinking V3 — Azit Move
**Motor de Crédito: Modelo Futuro (To-Be)**
Data: 2026-06-23

---

## Contexto

Este documento representa o exercício de design thinking do modelo futuro da plataforma Azit Move, com foco em como o sistema **deveria funcionar idealmente**, sem carregar vícios do modelo atual ou das limitações do Asaas. O objetivo é consolidar a visão do to-be antes de definir a estratégia de migração do legado.

A Azit Move não é um sistema de cobrança. É uma **plataforma de crédito** que opera ativos de terceiros e próprios, presta contas para múltiplos stakeholders e tem como coração a relação financeira completa entre a Azit e seus clientes.

---

## 1. Os Stakeholders e suas Visões

O sistema precisa atender quatro visões distintas sobre os mesmos dados:

**Cliente**
O que devo, o que já paguei, qual o valor para quitar hoje. Em algum momento essa visão será disponibilizada diretamente para ele.

**Time Operacional da Azit**
Portfólio de contratos, saúde da carteira, inadimplência por estágio, régua de cobrança ativa. Visão de quem opera o motor de crédito no dia a dia.

**Investidor de Ativo Específico**
Performance do contrato onde aportou capital. Capital investido, amortizado e a amortizar. Rendimento realizado vs esperado. Status do contrato do cliente vinculado ao seu ativo.

**Investidor de Fundo**
Performance consolidada do fundo. Retorno médio, inadimplência do portfólio, composição dos contratos ativos. Visão macro do capital alocado.

Cada visão consome os mesmos dados base, mas com perspectivas e níveis de detalhe diferentes. O sistema é a fonte única da verdade para todas elas.

---

## 2. Entidades Centrais

> **Nota de evolução:** este exercício de design thinking foi a origem da modelagem. Ao longo das validações seguintes, três entidades evoluíram, aplicando a régua "como funciona em um banco?": o **Cliente** virou **Titular** (cadastro único de pessoa), o **Investidor** deixou de ser entidade e virou um papel, e surgiu o **ContratoInvestimento** como espelho do contrato de crédito. As entidades abaixo já refletem esse entendimento final. A fonte da verdade detalhada é o doc 02 (domínio).

### Titular
Cadastro único de uma pessoa física ou jurídica com relacionamento financeiro com a Azit. É a entidade de identidade — existe antes de qualquer produto. "Cliente" e "investidor" são **papéis** que um titular exerce (ter contrato de crédito / ter contrato de investimento), não entidades separadas. Espelha o cadastro único por CPF de um banco.

### Conta
O relacionamento financeiro do titular. Não tem tipo — agrega tanto produtos de crédito (o que o titular deve) quanto de investimento (o que a Azit lhe deve). Um mesmo titular, na mesma conta, pode financiar um veículo e investir no fundo.

### Ativo
O bem objeto do contrato — hoje predominantemente veículos. Um ativo tem uma **origem de capital** definida (ver seção 3) e é vinculado a um ContratoCredito no momento da originação. Quando o contrato é quitado, o ativo é transferido ao titular e se encerra como ativo da Azit.

### ContratoCredito
A representação de **um produto de crédito vendido a um titular** (financiamento do veículo, crédito avulso). É a origem jurídica e comercial da relação de dívida — o titular **deve**. Um titular pode ter múltiplos contratos de crédito, cada um com seu próprio cronograma e extrato individualizado.

### ContratoInvestimento
O espelho do ContratoCredito, com o fluxo invertido: o titular aporta capital e a Azit devolve com rendimento — a Azit **deve** ao titular. Pendurado na conta como qualquer produto. Um titular é "investidor" simplesmente por ter um ou mais ContratoInvestimento.

### ItemContratado
Cada produto dentro da cesta do contrato de crédito. Pode ser recorrente (proteção veicular, taxa de serviço, rastreador) ou parcelado (financiamento do veículo, crédito avulso). Tem origem **venda** ou **acordo**. Cada item tem um **destino de recebível** definido — quem é o credor real daquele valor.

### Recebível
O direito financeiro gerado pelo contrato de crédito. Nasce no momento da criação do contrato — o cronograma completo já existe desde o dia zero. Tem dois estados: **esperado** (previsto no cronograma) e **realizado** (efetivamente pago). A diferença entre os dois alimenta a visão de performance do investidor.

Cada recebível realizado tem um breakdown automático:
- Amortização de capital do investidor
- Rendimento do investidor
- Taxa de serviço da Azit

### Fatura
A cobrança semanal que **agrega** os itens vencidos de todos os contratos de crédito ativos do titular. A fatura não é a origem da dívida — é o instrumento de cobrança. Ela existe desde o início do contrato e tem dois estados principais: **aberta** (ainda aceita novos itens) e **fechada** (congelada, cobrança gerada no Asaas).

---

## 3. Modelos de Capital

O contrato do cliente é sempre idêntico, independente de como o ativo foi financiado. A origem do capital é uma camada separada, transparente para o cliente.

**Investidor de Ativo Específico**
O investidor aporta capital para compra de um veículo específico. A Azit administra o contrato e recebe uma taxa de serviço. As parcelas do cliente amortizam o capital do investidor mais o rendimento acordado. Quando o contrato é quitado, o investidor recebeu tudo e o ativo transfere para o cliente.

**Investidor de Fundo**
O investidor aporta em um fundo que agrega múltiplos contratos. O retorno vem da performance consolidada do portfólio.

**Capital Próprio da Azit**
A Azit compra o ativo com caixa próprio. Todo o retorno do contrato é receita da Azit.

**Empréstimo**
A Azit toma crédito para comprar o ativo. O retorno do contrato precisa cobrir o custo do empréstimo mais a margem da operação.

---

## 4. Princípios do Modelo

Estes são os axiomas que guiam qualquer decisão futura sobre o sistema:

**Asaas executa, Azit controla**
O Asaas é o executor de cobranças. Toda a lógica de negócio, cronogramas, status e rastreabilidade vivem no sistema da Azit. O Asaas é um meio de pagamento, não a fonte da verdade.

**O recebível nasce no dia zero**
O cronograma completo de recebíveis é gerado no momento da criação do contrato. O sistema já sabe desde o primeiro dia o que espera receber em cada semana até a quitação.

**A dívida existe independente do ativo**
O cliente comprou o veículo. A obrigação financeira persiste independente do que acontecer com o bem — sinistro, furto, dano. Parcelas não são perdoadas; quando muito, são objeto de acordo ou novação.

**Toda cobrança tem um destino definido**
Cada item cobrado na fatura tem um credor definido. O sistema sabe para onde cada real deve ir quando o cliente paga. A execução do split pode ser manual hoje, mas o modelo de dados já contempla o destino.

**A fatura é o agregador, o contrato é a origem**
A fatura não é onde a dívida nasce — é onde ela é cobrada. A origem de cada cobrança é sempre rastreável ao seu contrato e item específico.

**Novos produtos entram na próxima fatura**
Quando uma fatura está fechada, qualquer novo contrato ou produto começa a partir da próxima fatura aberta. Não há exceções.

**O sistema é operado por humanos, não substituído por eles**
Ações críticas como desbloqueio de veículo, acordo e novação são registradas por humanos no sistema. O sistema executa as consequências automaticamente.

---

## 5. Fluxos Principais

### Fluxo 1 — Originação de ContratoCredito

A originação acontece **dentro do sistema**, operada em tela pelo operador (não mais via API do PopHub, que foi absorvido). O funil:

1. O operador inicia o atendimento (cria um Lead ou recupera um Titular pelo CPF) e simula condições sobre um ativo específico
2. O cliente escolhe uma oferta; ela vira proposta, e o cadastro completo é coletado (promovendo o Lead a Titular, com reconciliação por CPF)
3. A análise documental valida os documentos digitais e emite o parecer
4. Aprovada a proposta, a formalização congela o snapshot, gera o documento do contrato e cria o ContratoCredito, que gera o cronograma completo no dia zero
5. O cliente assina (hoje mock manual; integração de assinatura no futuro)
6. O pagamento da primeira cobrança da entrada (avulsa no Asaas) ativa o contrato e cadastra o cliente no Asaas

---

### Fluxo 2 — Fatura Semanal

As faturas já existem desde a originação. O ciclo semanal funciona assim:

1. No D-5 do vencimento, a fatura **fecha** — nenhum item novo entra nela
2. No fechamento, o sistema gera a cobrança no Asaas
3. No dia do vencimento, o cliente recebe a notificação via WhatsApp com valor e link
4. Pagamento recebido → webhook do Asaas notifica o sistema → sistema concilia, dá baixa na fatura e nas parcelas correspondentes, calcula o breakdown de recebíveis
5. Pagamento não recebido → fatura entra na régua de cobrança

Pagamentos com atraso: o sistema calcula o breakdown correto usando os parâmetros de multa e juros, independente do que o Asaas retornar.

---

### Fluxo 3 — Inadimplência e Régua de Cobrança

- **D+0** — vencimento sem pagamento, Asaas registra inadimplência
- **D+1** — bot inicia cobrança ativa via WhatsApp
- **D+2** — segunda tentativa de cobrança pelo bot
- **D+3** — bloqueio remoto do veículo (regra absoluta)
- **D+10** — notificação extrajudicial
- **D+12** — processo de recuperação

O desbloqueio após pagamento é **manual** — o time confirma a regularização antes de liberar o veículo.

O sistema mantém em tempo real, via webhook do Asaas, a posição de cada cliente na régua. O painel operacional responde a qualquer momento: quantos clientes estão em cada estágio e quem são.

---

### Fluxo 4 — Acordo e Novação

São **dois mecanismos distintos** de recuperação.

**Acordo (recuperação branda)**
Titular tem parcelas atrasadas. O Arthur registra o acordo no sistema:
- As parcelas em atraso cobertas recebem um **vínculo de acordo** (não o status "renegociada" como marca — esse status geraria ambiguidade)
- O acordo gera um **ItemContratado novo de origem ACORDO** — um crédito que dilui as parcelas em atraso
- As novas parcelas pertencem a esse item e entram na próxima fatura aberta
- O contrato principal **não é liquidado**; as demais parcelas seguem inalteradas, e o cliente permanece inadimplente para fins contábeis até cumprir o acordo
- O formato de exibição das parcelas é sempre número/total: 1/157, 1/12

**Novação (recuperação radical)**
Situação grave que exige recomeço, quando os acordos não recuperam o cliente:
- O contrato antigo é **liquidado por inteiro** (status "Liquidado por novação", preservado para auditoria)
- Um novo contrato nasce com novas condições, cronograma novo no dia zero
- Um registro de novação vincula o contrato antigo ao novo

A sequência operacional é: começar com acordos brandos; se não funcionam, a novação; se não funciona, a retomada do veículo. Acordo e Novação são sempre **operações humanas registradas no sistema** pelo time operacional, sujeitas à estrutura de alçadas. O sistema executa as consequências automaticamente após a confirmação da entrada via webhook.

---

### Fluxo 5 — Quitação Antecipada

O sistema oferece três variantes usando a fórmula de desconto parametrizável (a ser fornecida pelo Vicente):

**Quitação de parcelas específicas**
Cliente seleciona uma ou mais parcelas futuras para quitar antecipadamente. Sistema calcula o valor com desconto e baixa as parcelas selecionadas.

**Quitação total**
Cliente quita todo o saldo devedor restante. Sistema calcula o valor total com desconto, baixa todas as parcelas restantes e encerra o contrato.

**Encerramento do contrato**
Caso específico da quitação total onde, além de baixar as parcelas, o sistema registra a transferência do ativo ao cliente.

A taxa de desconto é um parâmetro configurável — não fica hardcoded na fórmula.

---

### Fluxo 6 — Sinistro

Definido na reunião de 23/06 com Vicente. O princípio: o titular comprou o veículo, a dívida existe independente do que acontece com o bem.

1. Sinistro é registrado no sistema
2. O seguro é acionado — a Azit consta como **beneficiária** do seguro obrigatório
3. A indenização recebida **amortiza** o saldo devedor do contrato (não quita automaticamente)
4. Se a indenização superar o saldo, o **excedente pertence ao titular**
5. Se for insuficiente, o **saldo remanescente continua obrigação do titular**

A dívida não é perdoada pelo sinistro. Parcelas não pagas são objeto de acordo ou novação, nunca apagadas.

---

### Fluxo 7 — Visão do Investidor

**Investidor de ativo específico**
A cada pagamento realizado, o sistema calcula automaticamente o breakdown do recebível. O investidor tem visão em tempo real:
- Capital investido vs amortizado vs a amortizar
- Rendimento acumulado realizado vs esperado
- Status do contrato e do cliente vinculado
- Projeção de encerramento

Quando o contrato é quitado, o investidor recebeu todo o capital mais o rendimento — o ciclo do ativo se encerra.

**Investidor de fundo**
Visão consolidada do fundo:
- Capital total alocado e retorno médio
- Taxa de inadimplência do portfólio
- Composição dos contratos ativos
- Performance do fundo no período

---

## 6. Itens em Aberto — Estado Atual

> Esta seção registrava os pontos pendentes ao fim do exercício de design thinking (23/06). Vários foram resolvidos nas validações seguintes. Estado atualizado abaixo.

**Resolvidos:**
- ✅ **Fluxo de sinistro** — definido em 23/06 (ver Fluxo 6)
- ✅ **Fórmula de quitação no dia** — definida: VP = VF / (1 + taxa)^tempo, com taxa diária parametrizável
- ✅ **Lista de status e situações** — validada com Vicente e documentada no doc 02
- ✅ **Natureza da proteção veicular** — tratada como item da cesta (ItemContratado), recorrente ou parcelada conforme necessidade de rastreabilidade

**Ainda em aberto (placeholders — todos com padrão funcional provisório):**
- ⏳ **Fórmula de precificação da parcela** — provisória (Price 0,5%/semana) em uso; definitiva com Vicente
- ⏳ **Breakdown do recebível** (amortização + rendimento + taxa) — depende da estrutura jurídica do fundo (Sebastião)
- ⏳ **Regras de split em caso de atraso** — distribuição de juros/multas entre recebedores acima de 30 dias (Vicente)
- ⏳ **Regras de alçada** — limites e níveis de aprovação (Vicente)
- ⏳ **Sistema de assinatura digital** — mock manual em uso; integração a definir (Luís)

---

*Documento de design thinking do modelo futuro (to-be) da plataforma Azit Move V3.*
*Versão 2.0 — 2026-06-27: originação absorvida (funil nativo em telas), distinção Acordo/Novação, placeholders atualizados.*
