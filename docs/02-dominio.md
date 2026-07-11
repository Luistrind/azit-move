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
- **O recebível nasce no dia zero do contrato ATIVO** — o cronograma completo é gerado na **ativação pelo pagamento da entrada** (não na formalização). Na originação nativa: formalização → *Aguardando assinatura* (sem cronograma); assinatura titular+Azit → cobrança da entrada → pagamento → "dia zero" → cronograma/recebíveis/faturas. (Decisão 2026-06-29.) Legado/novação geram o cronograma na criação por já nascerem ativos.
- **A dívida existe independente do ativo** — sinistro, furto ou dano não extinguem a obrigação do cliente.
- **Toda cobrança tem um destino definido** — cada item cobrado tem um credor explícito.
- **A fatura é o agregador, o contrato é a origem** — a dívida nasce no contrato, é cobrada na fatura.
- **Novos produtos entram na próxima fatura** — fatura fechada é imutável.
- **O sistema é operado por humanos, não substituído por eles** — ações críticas são registradas por humanos, o sistema executa as consequências.
- **Encargo → Serviço → Principal** — ordem de imputação de pagamentos.

---

## 3. Hierarquia de Entidades

```
ORIGINAÇÃO (funil que antecede e gera o contrato)
  Lead (pré-cadastro leve) ──promovido──► Titular
  Simulação (sobre um Ativo) ──► Oferta escolhida ──► Proposta ──► Análise/Parecer
  Proposta aprovada ──gera──► ContratoCredito

Titular (cadastro único — pessoa física ou jurídica, identificada por CPF/CNPJ)
└── Conta (relacionamento financeiro com a Azit — NÃO é conta corrente)
    ├── ContratoCredito (o que o titular DEVE — financiamento, crédito avulso)
    │   ├── Vínculo de Papel (Titulares: comprador principal, secundário, garantidor)
    │   ├── ItemContratado (produtos da cesta; origem venda ou acordo)
    │   ├── Parcela (cronograma de pagamento)
    │   ├── Fatura (cobrança — agrega itens de vários produtos/contratos)
    │   │   └── ItemFatura (itens agregados: parcela, intermediária, serviço, encargo)
    │   ├── Recebível (direito financeiro)
    │   ├── Acordo (recuperação branda — dilui parcelas, não liquida o contrato)
    │   └── Novação (recuperação radical — liquida o contrato, gera um novo)
    └── ContratoInvestimento (o que a Azit DEVE ao titular — aporte)
        └── OrigemCapital (liga o aporte aos ativos/contratos que financia)

Ativo (com valor de venda próprio; base da precificação)
└── vinculado a um ContratoCredito; financiado por uma OrigemCapital

Produtos apartados (ex: Seguro) — contratos próprios por razão jurídica/tributária,
  mas convergindo na mesma Fatura do titular
```

**Princípio:** a Conta não tem "tipo". Um mesmo titular pode, na mesma conta, ter contratos de crédito (devendo) e contratos de investimento (recebendo). O que o titular acessa é consequência do que a conta possui — não de um atributo que a classifica. Cliente e Investidor são **papéis** que um titular exerce, não entidades de identidade separadas.

> Espelha a lógica bancária: existe um cadastro único de pessoa (CPF), uma conta/relacionamento, e produtos pendurados nela — crédito de um lado, investimento do outro, no mesmo extrato consolidado. A "conta" aqui é visão unificada de relacionamento, **não** conta corrente.

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
- pode exercer papéis (comprador, garantidor) em propostas/contratos via Vínculo de Papel (ver 4-A.7)

> **Papéis:** um titular é "cliente" quando sua conta tem ContratoCredito; é "investidor" quando sua conta tem ContratoInvestimento. Pode ser os dois simultaneamente. O papel é derivado do que a conta possui, não armazenado como tipo.

---

### 4.2 IntervenienteGarantidor *(deprecado — ver Vínculo de Papel)*

> **Substituído pelo modelo de papéis.** O garantidor não é mais uma entidade de pessoa separada. Ele é um **Titular** (cadastro único por CPF) que exerce o **papel** de garantidor num contrato específico, via o **Vínculo de Papel** (4-A.7). Isso mantém a coerência com o princípio de que comprador/garantidor/investidor são papéis, não cadastros distintos — e evita um cadastro de segunda classe (o garantidor de hoje pode ser comprador amanhã, sem recadastro).
>
> A responsabilidade solidária pelo cumprimento das obrigações permanece como o significado do papel "garantidor"; muda apenas a forma de modelar (papel de Titular, não entidade própria).

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

> **Conta ≠ conta corrente.** A Conta deste modelo é uma **visão unificada de relacionamento/cadastro**, não um produto de conta corrente. Em nenhum lugar (sistema, documento, interface) a Conta deve sugerir conta corrente — isso traria obrigações regulatórias (prevenção à lavagem de dinheiro) e risco que estão fora do escopo. É apenas o agregador que unifica os contratos do titular.

---

## 4-A. Camada de Originação

As entidades a seguir compõem o funil que **antecede e gera** o ContratoCredito. A originação acontece **dentro do sistema**, operada em tela (canal interno do operador) ou, futuramente, em parte pelo próprio cliente (canal público). Substitui o que antes vinha via API do PopHub.

**Funil:** Lead/Titular → Simulação → Oferta escolhida → Proposta → Análise → (aprovação) → Formalização → ContratoCredito → Ativação.

### 4-A.1 Lead

Registro **leve** de uma pessoa que iniciou um atendimento mas ainda não tem cadastro pleno. Criado no pré-cadastro com o mínimo para liberar a simulação. Pode duplicar (mesma pessoa pode gerar vários leads ao longo do tempo) e pode nunca avançar.

**Campos:**
- `id`
- `nome`
- `cpf`
- `data_nascimento`
- `canal_origem` — ex: operador interno, landing page
- `data_criacao`

> **Lead vs Titular.** O Lead é só para quem **ainda não existe** no sistema. Se o CPF já pertence a um Titular, não se cria Lead — recupera-se o Titular. Quando a proposta avança e o cadastro completo é coletado, o Lead é **promovido a Titular**, com **reconciliação por CPF** (se já houver Titular com aquele CPF, reaproveita; leads anteriores do mesmo CPF são reconciliados, não duplicados).

### 4-A.2 Simulação

> **Decisão 2026-07-05, Luís (Etapa A — Simulação V3, doc do Vicente + planilha):** a simulação é a **porta de entrada comercial**, com cálculo no backend, **parâmetros versionados** e rastreabilidade completa. Linguagem comercial de **venda parcelada** — nunca "financiamento". A visão do cliente mostra só a condição comercial (veículo, valor à vista, entrada, prazo, frequência, parcela); CI/CR/TR e memória de cálculo são **internos**.

Sessão de exploração de condições para um **Ativo específico OU um valor à vista manual** (quando ainda não há veículo definido).

**Campos:**
- `id`
- `lead_id` ou `titular_id` — pode existir solta no início; vincula-se ao avançar
- `ativo_id` — opcional; quando ausente, `valor_avista` manual
- `valor_avista` — base comercial (do cadastro do ativo ou manual; origem registrada)
- `valor_entrada` — respeitando entrada mínima (parâmetro) e ≤ valor à vista
- `prazo_meses` — 6 a 48 (parâmetros), prazos padronizados 6/12/24/36/48
- `frequencia` — mensal | quinzenal | semanal (define a parcela final exibida)
- `status` — rascunho | calculada | apresentada | convertida | cancelada (**expirada é derivada** de `valida_ate` em runtime — Regra 7)
- `valida_ate` — validade (parâmetro `validade_dias`); conversão de expirada exige recálculo
- `parametro_versao_id` — **versão dos parâmetros usada no cálculo** (nunca recalcular silenciosamente)
- `observacoes_internas`, `data_criacao`

**Memória de cálculo (interna, backend):** `VP = VA + CI − EN` → `PM1 = VP × [TR×(1+TR)^PC] / [(1+TR)^PC − 1]` (Price mensal) → `PMT = PM1 + CR` → parcela quinzenal = PMT ÷ fator quinzenal; semanal = PMT ÷ fator semanal → `PF` conforme frequência.

**Parâmetros versionados (`VersaoParametrosSimulacao`):** CI (comissão consignado inicial), CR (comissão consignado recorrente), TR (taxa a.m.), entrada mínima, prazo mín./máx., prazos padronizados, **fator semanal = 4,345** e **fator quinzenal = 2,1725** (semanas/mês reais — decisão reunião 04/07; a planilha usava 4 e 2), validade em dias, ofertas padrão, vigência. Alteração restrita (ADMIN/DIRETOR) e **auditada**; nova configuração = **nova versão** (histórico preservado).

### 4-A.3 Oferta

Uma opção concreta apresentada na simulação. **Três origens**:
1. **Oferta padrão** — combos parametrizados (ex.: 48m/semanal/entrada 3.990) calculados automaticamente sobre o valor à vista;
2. **Oferta fixa** (entidade `OfertaFixa`) — condição comercial **desenhada** pela Azit (entrada e parcela em valores redondos, ex.: "R$ 599/semana"), com **ativos vinculados** a ela no cadastro; aparece em destaque quando o ativo selecionado está vinculado;
3. **Personalizada** — entrada/prazo/frequência informados pelo operador ("Simular outras opções").

**Campos:**
- `id`, `simulacao_id`
- `tipo` — oferta_fixa | padrao | personalizada
- `origem_calculo` — pacote_generico | valor_venda_ativo (legado)
- `valor_entrada`, `entrada_parcelada`
- `prazo_meses`, `frequencia`
- `valor_parcela` — PF calculada e **gravada** (não recalculada)
- `numero_parcelas` — arredondamento de `prazo_meses × fator` da frequência; última parcela absorve resíduo
- `selecionada` — booleano

> **Conversão em contrato:** periodicidade = frequência; nº de parcelas = prazo_meses × fator (mensal 1×, quinzenal 2,1725×, semanal 4,345×, arredondado); total idêntico ao plano mensal (resíduo na última parcela).

> **Decisão 2026-07-11 (reunião Vicente) — dois fatores, dois momentos:** na **precificação/simulação**, a parcela exibida divide o PMT por **4** (semanal) e **2** (quinzenal) — números comerciais, congelados no snapshot; o **4,345/2,1725** é usado só na **PARAMETRIZAÇÃO DO CONTRATO** para o nº exato de parcelas. A **quantidade de parcelas não aparece na simulação** (só prazo em meses + parcela + entrada). **Parametrização** é etapa própria antes da formalização: o operador define a **data da 1ª parcela** (ex.: segunda p/ motorista de app); a versão do texto do contrato carrega automática (a mais atual — admin gerencia, operador não escolhe). Mudança de parâmetro NUNCA afeta contratos/simulações existentes (snapshot). **Antecipação de parcela** (§7.4): parcela = capital + remuneração do capital + serviço → antecipando, **serviço é isento**, **remuneração recebe desconto na TR** e o capital é pago integral — *fórmula final das grandezas com o Vicente (pendente)*. **Capital: tratar tudo como capital de INVESTIDOR** (Popcarros = investidor) para simplificar o modelo — implementação plena junto com o breakdown do recebível.

> **Intermediárias (entrada parcelada):** quando a entrada é parcelada, no **mínimo 60%** vai numa única parcela à vista (a primeira), e o **restante (até 40%)** é diluído em parcelas-balão que concorrem com as parcelas do contrato (entram nas faturas seguintes como ItemFatura — ver 4.12).

### 4-A.4 Proposta

A oferta escolhida formalizada como pedido de crédito. É o que **persiste** e tem **máquina de estados própria** (distinta da do ContratoCredito). A proposta aprovada **gera** o ContratoCredito.

**Campos:**
- `id`
- `simulacao_id` / `oferta_id` — a oferta que originou a proposta
- `titular_id` — comprador principal (após promoção do lead)
- `ativo_id`
- `modalidade` — assinatura | compra_parcelada | compra_vista
- `valor_entrada`, `prazo_semanas`, `valor_parcela`, `numero_parcelas` — condições da oferta escolhida
- `status` — pendente | em_análise | aprovada | reprovada | cancelada | em_formalização | convertida
- `parecer_id` — resultado da análise
- `data_criacao`

**Relacionamentos:**
- vincula um ou mais `Titular` com **papel** (ver 4-A.7) — comprador principal, comprador secundário, garantidor
- referencia um `Ativo`
- gera um `ContratoCredito` na conversão

> **Status e transições:** Pendente → Em Análise → Aprovada/Reprovada → Em Formalização → Convertida (ou Cancelada). Aprovada/Reprovada só ocorrem **dentro do fluxo de análise documental** (com parecer), não por movimentação livre. Convertida significa que o ContratoCredito já foi gerado.

### 4-A.5 DocumentoProposta

Documento **digital anexado** ao cadastro de uma pessoa no contexto de uma proposta. A análise é manual quanto ao julgamento, mas a coleta é 100% digital — nada de papel físico.

**Campos:**
- `id`
- `proposta_id`
- `titular_id` — a quem o documento pertence (por papel)
- `tipo` — cnh | comprovante_endereco | comprovante_renda | relatorio_brick | outro
- `arquivo_ref` — referência do arquivo armazenado
- `data_anexo`

> Documentos obrigatórios do comprador principal (conhecimento herdado do PopHub): **CNH**, **comprovante de endereço**, **comprovante de renda** (extratos de plataformas como Uber, 99, InDrive, etc.), **relatório Brick**. Comprador secundário, quando incluído, exige conjunto equivalente.

### 4-A.6 Parecer

Resultado da análise de crédito de uma proposta. Modelado como **resultado** independente de origem — hoje preenchido por um analista (manual), no futuro podendo vir de bureau de crédito ou regras automáticas, sem refazer a estrutura.

**Campos:**
- `id`
- `proposta_id`
- `resultado` — aprovado | aprovado_com_ressalvas | reprovado
- `motivo_reprovacao` — de uma lista, quando reprovado
- `exige_garantidor` — booleano (aprovação com ressalvas pode exigir)
- `analista_id` — quem emitiu (nulo quando automático, no futuro)
- `data`

> Estrutura **preparada para evoluir**: integração futura com bureaus (Serasa/SPC) e lista própria de parâmetros de aprovação automatizados. Não entra na primeira versão completa, mas o modelo não fecha portas.

### 4-A.7 Vínculo de Papel (Titular ↔ ContratoCredito / Proposta)

Não é uma entidade de pessoa — é o **vínculo** que dá a um Titular um papel num contrato/proposta específico. "Comprador" e "garantidor" são papéis, não cadastros separados (mesma lógica de cliente/investidor).

**Campos:**
- `id`
- `proposta_id` ou `contrato_credito_id`
- `titular_id`
- `papel` — comprador_principal | comprador_secundario | garantidor

> **CPF único entre papéis:** como o Titular já é único por CPF, basta impedir que o mesmo Titular ocupe dois papéis no mesmo contrato. O garantidor não é cadastro de segunda classe — se amanhã quiser financiar, já é Titular.

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
- `valor_aquisicao` — custo de aquisição (quanto a Azit pagou pelo veículo)
- `valor_venda` — valor de venda do ativo, cadastrado manualmente; **base da precificação individualizada** na simulação
- `pacote_oferta_id` — vínculo opcional a um pacote/oferta genérica (legado PopHub); quando presente, o pacote aparece como opção na simulação
- `status` — disponivel | em_contrato | quitado | recuperado | sinistrado

**Relacionamentos:**
- tem uma `OrigemCapital`
- vinculado a um `ContratoCredito`

> **Precificação centrada no ativo.** Cada ativo (veículo usado) tem custo próprio, por isso a precificação parte do **valor de venda do ativo individual**, não de um produto-catálogo genérico — corrige o erro do PopHub, onde o produto genérico ignorava o custo de aquisição real e prejudicava a rastreabilidade para o investidor. A oferta genérica (via `pacote_oferta_id`) **coexiste temporariamente** como andaime de transição; a direção definitiva é o modelo por ativo. Regra de estoque: **1 ativo = 1 contrato ativo** (ativo "em_contrato" não aparece como disponível para nova simulação).

---

### 4.4-A Centro de custo do Ativo

> **Decisão 2026-07-05, Luís:** todo Ativo é um **centro de custo**. Início com frota 100% capital próprio: cadastra-se o ativo com o **valor de aquisição** (sem margem no cadastro) e acompanha-se **quanto gastamos × quanto recebemos** por veículo.
>
> - **Custos:** `valorAquisicao` (cadastro) + **lançamentos de custo** (`LancamentoCustoAtivo`: tipo livre — manutenção, documentação, seguro, franquia… —, descrição, valor, data, quem lançou). Tipo é texto (catálogo aberto): expandir é dado, não migração.
> - **Receitas (calculadas em runtime — Regra 7):** entrada paga + parcelas pagas de todos os contratos do ativo (acordos e itens do contrato entram automaticamente). Nada de receita gravada.
> - **Visões:** por veículo (gasto, recebido, a receber, resultado) e **crédito avulso como centro de custo próprio agregado** (quanto foi liberado × quanto retornou × em aberto) — os ativos sintéticos `OUTRO` do crédito dão a granularidade.
> - **Expansão prevista (sem mudar a estrutura):** veículo de investidor/fundo entra pela dimensão `OrigemCapital` (já 1:1 com o ativo); centros não-ativo (corporativo, despesas gerais) entram como novas visões sobre o mesmo livro de lançamentos.

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

### 4.7-A Crédito de manutenção (crédito para cliente já ativo)

> **Decisão 2026-07-02, Luís:** um titular com contrato ativo pode contratar um **crédito de manutenção** (crédito avulso — reparo do veículo, capital, etc.). Modelagem:
>
> - **Produto de valor variável** (`Produto.valorPadrao = null`, `ancora = false`, `credorPadrao = AZIT`): não tem preço fixo — só regras de juros/tabela aplicadas sobre o valor pedido na contratação.
> - **Ancoragem no ativo:** todo `ContratoCredito` exige um `ativo`. O crédito de manutenção nasce ancorado num **Ativo sintético `tipo = OUTRO`** ("Crédito manutenção — <titular>"), com sua própria `OrigemCapital` (capital AZIT). O vínculo *real* é com o **titular** e com a **fatura** — não com um veículo.
> - **Cobrança na mesma fatura:** é um `ContratoCredito` **à parte**, mas reusa a **Conta existente** do titular; suas parcelas/recebíveis caem nas **faturas da conta** junto com o contrato do veículo (a Conta é a visão unificada — §4.3).
> - **Modalidade `COMPRA_PARCELADA`:** não há assinatura formal (titular+Azit). É um parcelamento de um valor pré-definido; entrada é **opcional** (`valorEntrada` pode ser 0). Novo campo `ContratoCredito.modalidade` (default `ASSINATURA` para o veículo; `COMPRA_PARCELADA` para o crédito de manutenção).
> - **Gatilho de ativação (exceção à Regra 2):** *sem* entrada → o "dia zero" é a **aprovação pela alçada** (não o pagamento da entrada); o cronograma nasce na aprovação. *Com* entrada (opcional) → cobra a entrada e o dia zero é o pagamento dela, como no veículo.
> - **Esteira:** *sem* análise documental (cliente já conhecido), mas **passa obrigatoriamente pela alçada de aprovação** (§7.9). Reaproveita `Proposta` (`StatusProposta`, `aprovadoPor`, `dataAprovacao`) e o `model Alcada` (`tipoOperacao = "credito_avulso"`). Limites da alçada são **placeholder do Vicente** — padrão provisório configurável, marcado como substituível.

---

### 4.8 TipoProduto

Catálogo de produtos/serviços que a Azit oferece. Cada produto pode ter seu próprio contrato, ou compor a cesta de um contrato — conforme a configuração.

| Produto | Natureza | Credor Padrão | Observação |
|---|---|---|---|
| Parcelamento do veículo | parcelado | azit ou investidor | Produto âncora do ContratoCredito |
| Proteção veicular / Seguro | recorrente | azit ou terceiro | **Apartado** por questões jurídicas/tributárias (ver nota) |
| Rastreador | recorrente | azit ou terceiro | Valor alterável sem impactar parcelas |
| Taxa de serviço | recorrente | azit | |
| Crédito avulso | parcelado | azit | Para manutenção, pneus, despesas, débitos |

> **Produtos configuráveis e contratos apartados.** A Azit oferece múltiplos produtos do lado do consumo. Alguns precisam ser **apartados por razões jurídicas e tributárias** — notadamente o **seguro/proteção veicular**, que **não pode ser misturado** ao contrato de compra e venda do veículo. O contrato de compra e venda é só isso; seguro é contrato próprio.
>
> O princípio é a **configurabilidade**: assim como os templates de documento são configuráveis (não se programa um a cada produto), a estrutura de contrato também é. Não se modela uma entidade nova a cada produto — existe a noção de Produto, e o contrato é configurável (específico de um produto ou genérico servindo vários), com características preenchidas por **placeholders configuráveis**.
>
> **Cobrança independe da separação contratual:** um titular pode ter vários produtos/contratos, e todos convergem para **uma fatura**. A Fatura agrega ItemFatura de origens diferentes (financiamento, seguro, outros) num único documento — o modelo de Fatura/ItemFatura já suporta isso.
>
> *Nível de cravamento:* o princípio é firme; a estrutura detalhada (quais produtos, quais características, genérico vs específico) fica **preparada mas não cravada**, a amadurecer.

---

### 4.9 ItemContratado

Cada produto da cesta vinculado ao contrato. É a origem rastreável de cada cobrança. Pode nascer de uma **venda** (produto contratado) ou de um **acordo** (crédito que dilui parcelas em atraso — ver 4.14 e 7.7).

**Campos:**
- `id`
- `contrato_id`
- `tipo_produto_id`
- `descricao`
- `natureza` — recorrente | parcelado
- `origem` — venda | acordo
- `acordo_origem_id` — quando origem = acordo, o acordo que gerou este item
- `credor` — azit | investidor | terceiro
- `credor_id` — quando credor = investidor ou terceiro
- `valor`
- `numero_parcelas` — quando natureza = parcelado
- `periodicidade` — semanal | quinzenal | mensal
- `data_inicio`
- `data_fim` — quando natureza = recorrente, equivale ao encerramento do contrato
- `status` — ativo | encerrado | cancelado

> **Origem = acordo:** quando um Acordo é efetivado, ele gera um ItemContratado próprio (tipo "Crédito de acordo") com natureza parcelada. As novas parcelas do acordo pertencem a este item — não são parcelas soltas. O contrato principal **não** é liquidado (isso seria Novação, mecanismo distinto — ver 4.16). O Acordo apenas dilui as parcelas em atraso num novo item de crédito.

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

Cada item agregado dentro de uma fatura. É o vínculo entre a fatura e sua origem contratual. Uma fatura agrega itens de **origens diferentes** (parcela do financiamento, intermediária da entrada, serviços recorrentes, encargos) e até de **múltiplos produtos/contratos** do mesmo titular num único documento de cobrança.

**Campos:**
- `id`
- `fatura_id`
- `parcela_id` — origem da cobrança (quando aplicável)
- `tipo` — principal | intermediaria | servico | encargo
- `descricao`
- `valor`
- `credor` — azit | investidor | terceiro
- `credor_id`

> **Intermediárias:** as parcelas-balão da entrada parcelada (1/3, 2/3, 3/3) não têm vencimento próprio — entram como `ItemFatura` de tipo **intermediaria** nas faturas dos períodos correspondentes, ao lado da parcela regular. A **entrada** (primeira parcela, mín. 60%) é o primeiro ItemFatura da primeira Fatura do contrato (ver fluxo de ativação 8.1).

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

Mecanismo **brando** de recuperação de crédito: renegocia **parcelas específicas em atraso** sem liquidar o contrato principal. O contrato segue existindo com suas demais parcelas inalteradas. É o primeiro recurso da operação quando um cliente atrasa.

> **Acordo ≠ Novação.** O Acordo mitiga apenas o que está atrasado (poucas parcelas no universo do contrato); as parcelas futuras não mudam, não há aditivo no documento, o contrato principal **não é liquidado**. A Novação (4.16) é o mecanismo radical que liquida o contrato inteiro. Sequência operacional: começa-se com **Acordos**; se não funciona, **Novação**; se não funciona, retomada do veículo.

**Detalhe contábil:** mesmo com Acordo firmado, o cliente **continua inadimplente para efeitos de contabilidade** até cumprir o acordo (sai de cadastros de proteção ao crédito por estar negociando, mas a inadimplência persiste até a quitação do acordo).

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
- vinculado a um `ContratoCredito` (que **não** é liquidado)
- referencia as `Parcela` cobertas (que recebem vínculo de acordo — ver nota sobre status)
- gera um `ItemContratado` de origem ACORDO, que contém as novas `Parcela`

> **Status da parcela coberta:** a parcela antiga **não** usa o status "Renegociada" como marca do vínculo — "renegociação" já é um status de parcela e geraria ambiguidade. A parcela coberta recebe um vínculo de **acordo** (registra-se que ela foi objeto de um acordo) e as novas parcelas nascem como frutos desse acordo, num ItemContratado próprio. A mecânica é a mesma já modelada (origem do ItemContratado dedicada ao acordo, cronograma nascendo no D0); apenas o **nome** muda de "novação" para "acordo".

---

### 4.16 Novação

Mecanismo **radical** de recuperação: **liquida o ContratoCredito inteiro** e faz nascer um **ContratoCredito novo completo** em seu lugar, com novas condições. É a alternativa quando os Acordos brandos não recuperam o cliente, antes da retomada do veículo.

> Diferença essencial para o Acordo: o Acordo mexe em **parcelas** (poucas, pontuais) e preserva o contrato; a Novação extingue o **contrato inteiro** (todas as parcelas, todo o saldo) e cria outro. Juridicamente é novação no sentido pleno — a obrigação antiga é extinta e substituída por uma nova.

**Campos:**
- `id`
- `contrato_origem_id` — o ContratoCredito liquidado
- `contrato_novo_id` — o ContratoCredito gerado
- `operador_id`
- `data_efetivacao`
- `saldo_liquidado` — saldo do contrato extinto
- `status` — rascunho | ativo | cancelado
- `observacao`

**Relacionamentos:**
- liquida um `ContratoCredito` (origem — vai para estado terminal próprio)
- gera um `ContratoCredito` novo (com cronograma novo nascido no D0)

> **Status do contrato origem:** o contrato liquidado por novação vai para um estado terminal específico (ver 5.2), preservado para auditoria. O contrato novo começa sua máquina de estados normalmente.

---

### 4.17 ReajusteIPCA

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
| Suspenso / Pausado | Pausado temporariamente por situação especial |
| Em recuperação de veículo | Processo de retomada do veículo em andamento |

**Encerramento:**
| Status | Descrição |
|---|---|
| Cancelado | Encerrado antes da ativação ou por erro/distrato |
| Rescindido | Encerrado por inadimplência grave após retomada do veículo |
| Liquidado por novação | Extinto por novação (substituído por um contrato novo); preservado para auditoria |
| Quitado (aguardando transferência) | Obrigações pagas, transferência do ativo pendente |
| Quitado (transferência efetivada) | Obrigações pagas e ativo transferido ao cliente |

> **Nota:** O contrato não tem status "Renegociado". O **Acordo** (recuperação branda) é um evento registrado na entidade `Acordo` e não muda o status do contrato (que segue como está, inadimplente até o acordo ser cumprido). A **Novação** (recuperação radical) leva o contrato origem a "Liquidado por novação" e cria um contrato novo. Acordo e Novação são mecanismos distintos (ver 4.14, 4.16, 7.7, 7.7b).

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

### Gatilho 5 — Operador registra acordo
- Acordo: nasce em **Rascunho**
- Fatura: permanece em estado atual *(ainda não mudou)*
- Parcelas: permanecem em estado atual
- Contrato: permanece em estado atual (NÃO é liquidado)
- Ação: sistema gera cobrança da entrada no Asaas

### Gatilho 6 — Entrada do acordo confirmada via webhook
- Acordo: Rascunho → **Ativo**
- Parcelas cobertas: recebem **vínculo de acordo** *(não usar status "Renegociada" como marca — gera ambiguidade; registra-se que a parcela foi objeto de acordo)*
- Novas parcelas: nascem com status **Em aberto**, num `ItemContratado` de origem ACORDO
- Contrato: permanece o mesmo (NÃO liquidado); para fins contábeis, inadimplência persiste até o acordo ser cumprido

### Gatilho 6b — Novação efetivada
- Contrato origem: → estado terminal **Liquidado por novação** *(preservado para auditoria)*
- Contrato novo: criado, cronograma novo no D0, inicia sua máquina de estados
- Registro de `Novação`: vincula origem e novo

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

> **Decisão 2026-07-11, Vicente (planilha "Extrato parcelas") — antecipação com duas taxas.** Cada parcela em aberto é decomposta em **CR** (comissão recorrente — serviço) e **PS** (capital + remuneração). Cada componente desconta com sua própria taxa; o desconto forte do CR (20% a.m.) é a forma prática de "isentar" o serviço das parcelas distantes, mantendo o capital + TR integrais.

```
d(tm)  = (1 + tm)^(1/30) − 1          // taxa DIÁRIA equivalente à mensal tm
VP     = CR / (1 + d(dcr))^dias  +  PS / (1 + d(dps))^dias
```
Onde:
- `CR` = componente de comissão recorrente da parcela = CR mensal da versão de parâmetros ÷ fator de precificação da frequência (semanal ÷4, quinzenal ÷2, mensal ÷1)
- `PS` = valor nominal da parcela − CR (capital + remuneração)
- `dcr` = taxa de desconto do CR (`taxaDescontoAntecipacaoCR` da versão de parâmetros; padrão **20% a.m.**)
- `dps` = **TR do contrato** (a `taxaMensal` da mesma versão de parâmetros congelada na simulação)
- `dias` = dias entre a data de consulta/pagamento e o vencimento da parcela (vencida/hoje = 0, sem desconto)

A fórmula é aplicada parcela a parcela. O valor de quitação total é a soma dos VP de todas as parcelas restantes.

**Contratos sem versão de parâmetros** (legado/crédito avulso): CR = 0 e taxa única `taxaDescontoQuitacao` do contrato — comportamento anterior preservado.

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

### 7.7 Acordo (recuperação branda)

> **Decisão 2026-07-03, Luís — o Acordo é da CONTA, não do contrato.** O pagamento acontece na fatura, e a fatura é da Conta: ela agrega parcelas de *todos* os contratos do titular. Logo a inadimplência é da conta — o titular nunca atrasa "um contrato", atrasa faturas. A renegociação, portanto, cobre **todas as parcelas em atraso da conta** (de todos os contratos) numa única negociação: uma entrada, um plano novo, uma conversa.

- Operador inicia a renegociação **a partir da ficha do titular** (wizard: diagnóstico → proposta → aprovação → confirmação)
- O sistema levanta as parcelas em atraso de **todos os contratos da conta**, soma o saldo e permite estruturar o acordo
- Acordo nasce em **Rascunho** e passa pelo **motor de aprovação** (§7.9-A); aprovado, cobra-se a entrada
- Pagamento da entrada via webhook do Asaas é o aceite formal do cliente
- Após confirmação:
  - As parcelas cobertas recebem **vínculo de acordo** (não usar o status "Renegociada" como marca do vínculo — "renegociação" já é status de parcela)
  - **Explosão interna por contrato:** o acordo gera um `ItemContratado` de origem **ACORDO** *em cada contrato afetado*, com as parcelas novas rateadas proporcionalmente ao que cada contrato devia. Isso preserva a separação credor/recebível (parcela de contrato financiado por investidor ≠ parcela de capital Azit) — o titular vê **um acordo**; o sistema mantém o rastro por contrato
  - Os **contratos NÃO são liquidados**; as demais parcelas seguem inalteradas
- Novas parcelas entram na próxima fatura aberta da conta
- O cliente permanece inadimplente para fins contábeis até cumprir o acordo

### 7.7b Novação (recuperação radical)
- Mecanismo distinto do Acordo: **liquida o ContratoCredito inteiro** e gera um **ContratoCredito novo** completo
- Usado quando os Acordos brandos não recuperam o cliente, antes da retomada do veículo
- O contrato origem vai para estado terminal de novação (preservado para auditoria); o contrato novo nasce com cronograma novo no D0
- Passa pela estrutura de alçadas (operação mais sensível que o Acordo)

### 7.8 Tratamento de Sinistro
- A dívida do cliente não é automaticamente perdoada em caso de sinistro, furto, roubo ou perda total
- O cliente permanece responsável pelo saldo devedor
- A Azit deve constar como beneficiária do seguro obrigatório previsto em contrato
- Indenização recebida: amortiza o saldo devedor (não quita automaticamente)
- Sobra após amortização: pertence ao cliente
- Saldo remanescente após indenização: continua obrigação do cliente

### 7.9 Alçadas de Aprovação
Estrutura transversal aplicável a:
- Acordos (recuperação branda)
- Novações (recuperação radical)
- Financiamento de despesas de clientes
- Reajuste IPCA
- Venda de produtos e crédito avulso
- Qualquer operação com parcelamento, risco ou exceção

> ⚠️ **Placeholder (valores):** os *limites* concretos (quanto cada papel aprova) a definir com Vicente. A **estrutura**, porém, é configurável em tela — não hardcoded.

> **Decisão 2026-07-02, Luís:** a alçada é uma **matriz configurável pelo administrador**, não valores de seed. Modelagem:
>
> - **Catálogo de tipos de operação** (`TipoOperacaoAlcada`: `chave`, `nome`, `ativo`) — extensível pelo admin. Semeado com: `credito_avulso`, `acordo`, `novacao`, `reajuste_ipca`, `despesa`, `venda`. Novos tipos (ex.: outra modalidade de renegociação) entram sem mexer no código.
> - **Matriz de limites por papel** (`Alcada`: `papel` [RoleUsuario] × `tipoOperacao` → `limiteMaximo`, `ilimitado` bool, `ativo` bool; único por (papel, tipoOperacao)). O admin edita quanto cada **papel** (OPERADOR, APROVADOR, ADMIN, DIRETOR, FINANCEIRO) aprova em cada tipo de operação. `ilimitado = true` dispensa o teto (ex.: DIRETOR).
>   - *(Muda o esqueleto anterior de `Alcada` per-usuário → per-papel. Override por usuário individual fica como extensão futura, se necessário.)*
> - **Regra de aprovação:** para aprovar uma operação de valor *V* e tipo *T*, o usuário precisa de uma linha ativa `Alcada(papel = papel do usuário, tipoOperacao = T)` com `ilimitado` **ou** `limiteMaximo ≥ V`. Caso contrário, a operação fica **pendente** para um papel de alçada suficiente.
> - **Admin em tela:** tela de Configurações → Alçadas, onde o administrador gerencia o catálogo de operações e a matriz papel × limite. Aplica-se de forma transversal a crédito avulso, acordo, novação, reajuste, etc.

### 7.9-A Motor de Aprovação (unificado)

> **Decisão 2026-07-03, Luís:** toda operação sensível passa por um **motor de aprovação único** — propor e aprovar são atos distintos, de pessoas distintas. Substitui os fluxos ad-hoc (acordo que validava alçada na criação, crédito com fila própria, reajuste com aprovação embutida).

- **Solicitação (`Aprovacao`):** qualquer operação sujeita a alçada (crédito avulso, acordo, novação, reajuste, …) gera uma solicitação com: tipo de operação, valor, solicitante, referência à entidade (contrato/acordo/reajuste), contexto do titular e **trilha de decisões** (quem, quando, decisão, parecer).
- **Decisões possíveis:** **Aprovar** (exige alçada suficiente para o valor), **Recomendar** (endosso de quem NÃO tem alçada — escala para o nível acima, registrado na trilha) e **Reprovar** (exige alçada; encerra a solicitação).
- **N aprovações configurável:** cada tipo de operação define `aprovacoesNecessarias` (default 1) — editável pelo admin na tela de Alçadas. A solicitação só é APROVADA após N decisões "Aprovar" de **usuários distintos, cada um com alçada** para o valor (princípio dos quatro olhos, ex.: novação exige 2).
- **Segregação:** o solicitante **não decide** a própria solicitação — nem aprovar, nem recomendar, nem reprovar.
- **Efetivação:** ao completar as N aprovações, o motor dispara a efetivação da operação (ex.: crédito → ativa/cobra entrada; acordo → cobra entrada; novação → liquida e cria o contrato novo; reajuste → aplica).
- **Central única:** a tela de Aprovações lista TODAS as solicitações pendentes, com contexto do titular (atraso, contratos, saldo) — aprovar às cegas não é aprovar.
- Estados da solicitação: `PENDENTE → APROVADA | REPROVADA | CANCELADA`.

---

## 8. Fluxos Principais

### 8.1 Originação de ContratoCredito (funil em tela)

A originação acontece **dentro do sistema**, operada em tela — não mais via API do PopHub. O dado nasce na tela (entrada humana); apenas a confirmação de pagamento (Asaas) e, no futuro, a assinatura digital, vêm de integração externa.

**Pré-cadastro e simulação:**
1. Operador inicia o atendimento: CPF novo → cria `Lead`; CPF conhecido → recupera `Titular`
2. Seleciona um `Ativo` disponível e simula condições (entrada, prazo em semanas)
3. Sistema calcula as `Oferta` (a partir do valor de venda do ativo e/ou pacote genérico vinculado); operador e cliente comparam e escolhem uma
4. Se a entrada é parcelada, configura **intermediárias** (mín. 60% à vista, até 40% diluído)

**Proposta e análise:**
5. Oferta escolhida vira `Proposta` (status Pendente)
6. Coleta do cadastro completo → **promoção do Lead a Titular** (reconciliação por CPF)
7. Anexo dos documentos digitais (`DocumentoProposta`) por papel (comprador principal, secundário, garantidor); análise documental emite o `Parecer`
8. Proposta: Pendente → Em Análise → Aprovada/Reprovada (decisão de crédito ocorre no fluxo de análise)

**Formalização:**
9. Proposta aprovada → operador formaliza
10. Sistema **congela o snapshot** (fotografia imutável de pessoas/papéis, ativo, condições, valores, oferta) — fonte da geração documental
11. Motor de **templates gera o documento** do contrato a partir do snapshot
12. Nasce o `ContratoCredito` em **Aguardando assinatura**
13. **Assinatura** (provisória/mock): operador baixa o contrato, cliente assina por fora, operador sobe o assinado e marca como assinado. *(Estrutura preparada para integração de assinatura digital futura, via webhook.)*

**Ativação:**
14. Contrato assinado → sistema gera a **primeira Fatura** (a entrada), cobrada como **cobrança avulsa no Asaas** (cliente ainda não cadastrado lá)
15. O **ID da cobrança avulsa é guardado e vinculado ao Titular** (referência que não pode se perder — senão a entrada fica órfã no espelho de pagamento)
16. Cliente paga a primeira cobrança da entrada → **webhook do Asaas confirma** (gatilho da ativação)
17. Confirmação dispara: **ativa o ContratoCredito** + **cadastra o cliente no Asaas** (cliente pleno) + registra o pagamento no espelho do titular
18. Na ativação, o cronograma completo já existe (gerado no D0): `Parcela`, `Fatura` futuras e `Recebível` para cada parcela

> **Snapshot vs cadastro vivo.** O documento do contrato é gerado a partir do **snapshot** congelado na formalização, não do cadastro vivo do Titular. Garante fidelidade ao momento da assinatura e reprodutibilidade (regerar idêntico anos depois). O cadastro vivo segue como fonte única da verdade para o uso operacional — sem cópia de campos soltos.

> **Migração de legados:** os contratos legados são importados pela mesma lógica de originação (criar Titular/Conta/Ativo/ContratoCredito com cronograma), não por uma cadeia paralela. Sem "produto oculto" como no PopHub.

### 8.2 Ciclo Semanal de Fatura
1. Faturas existem desde a originação com status **Aberta**
2. Em D-5: fatura **fecha** — nenhum item novo entra
3. Sistema gera cobrança no Asaas → `asaas_charge_id` registrado na fatura
4. Fatura: Aberta → **Fechada**
5. No dia do vencimento: cliente notificado via WhatsApp com valor e link
6. Pagamento confirmado via webhook → sistema concilia → baixa na fatura e parcelas → breakdown de recebíveis calculado
7. Sem pagamento → fatura → **Vencida** → régua de cobrança ativada

### 8.3 Acordo (recuperação branda)
1. Operador acessa o módulo e seleciona obrigações em atraso
2. Sistema soma o saldo total
3. Operador estrutura o acordo (valor entrada, número de parcelas, valor da parcela)
4. Acordo passa pela estrutura de alçadas
5. Após aprovação: sistema cria `Acordo` em **Rascunho** e gera cobrança da entrada no Asaas
6. Cliente paga a entrada → webhook confirma
7. Sistema efetiva o acordo:
   - `Acordo`: Rascunho → **Ativo**
   - Parcelas cobertas recebem **vínculo de acordo** (contrato principal NÃO liquidado; demais parcelas inalteradas)
   - Sistema cria um `ItemContratado` de origem **ACORDO**, vinculado ao acordo
   - Novas parcelas nascem vinculadas a esse item, com numeração própria (1/12, 2/12...), e entram na próxima fatura aberta
   - Cliente permanece inadimplente para fins contábeis até cumprir o acordo

### 8.3b Novação (recuperação radical)
1. Operador identifica que os acordos não recuperaram o cliente
2. Estrutura a novação (novas condições do contrato substituto)
3. Passa pela estrutura de alçadas
4. Após aprovação e aceite: sistema **liquida o ContratoCredito origem** (estado terminal de novação, preservado para auditoria)
5. Sistema gera um **ContratoCredito novo** completo, com cronograma novo nascido no D0
6. Registro de `Novação` vincula os dois contratos (origem e novo)

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

### 11.1 PopHub (Absorvido — não é mais integração)
- O PopHub **deixa de existir como sistema separado**. Sua função (originação: cadastro, simulação, proposta, análise, geração de contrato) é **absorvida** para dentro deste sistema, operada em tela.
- Não há mais "entrada via API do PopHub". A originação nasce na tela (ver fluxo 8.1).
- O **conhecimento de negócio** do PopHub foi preservado (documentos obrigatórios, fórmula de precificação como referência histórica, máquina de estados da proposta); a estrutura técnica antiga e suas gambiarras (produto-catálogo genérico, "produto oculto" de legado, dados desnormalizados) foram **descartadas**.

### 11.2 Asaas (Execução de Pagamentos)
- **Direção:** bidirecional
- **Azit → Asaas:** criação de cobranças (avulsas, nunca assinaturas)
- **Asaas → Azit:** webhooks de confirmação de pagamento
- **Fluxo de ativação:** a primeira cobrança (entrada) é **avulsa** — o cliente só é cadastrado no Asaas **após** a confirmação do pagamento que ativa o contrato. O `asaas_charge_id` da cobrança avulsa é vinculado ao Titular para não perder a referência no espelho de pagamento.
- **Regra:** uma cobrança ativa por contrato por vez, gerada em D-5
- **Juros/multas:** calculados automaticamente pelo Asaas no momento do pagamento; sistema recalcula internamente para conciliação

### 11.3 WhatsApp / Z-API (Comunicação)
- **Direção:** Azit → Cliente
- **Uso:** notificação de vencimento, cobrança na régua, comunicados operacionais

### 11.4 Assinatura Digital (provisória — mock manual)
- Hoje a assinatura é **manual**: o sistema gera o documento, o operador baixa, o cliente assina por fora, o operador sobe o assinado.
- Estrutura preparada para **integração de assinatura digital** futura (a Azit possui um sistema, a definir qual), que confirmará a assinatura provavelmente via webhook — mesma natureza do Asaas. Quando entrar, substitui o baixar/subir sem mudar os estados ao redor.

---

## 12. Placeholders — A Definir

| Item | Descrição | Responsável |
|---|---|---|
| Fórmula de precificação da parcela | Cálculo da oferta a partir do valor de venda do ativo + entrada + prazo. **Provisória em uso** (Tabela Price, taxa 0,5%/semana parametrizável), substituível sem refazer estrutura | Vicente |
| Fórmula de breakdown do recebível | Como calcular exatamente a divisão entre amortização de capital, rendimento do investidor e taxa de serviço por pagamento | Vicente / Sebastião (depende da estrutura jurídica do fundo) |
| Regras de alçadas de aprovação | Quem aprova o quê, limites de valor por tipo de operação e perfil de usuário | Vicente |
| Regra de split em atraso >30 dias | Como distribuir juros e multas entre operação e investidor em atrasos prolongados. Input do Vicente: primeiras semanas com a Azit, após ~1 mês compartilhar com investidor | Vicente |
| Estrutura jurídica do fundo | Modelo legal para repasse ao investidor pessoa física | Sebastião |
| Sistema de assinatura digital | Qual ferramenta de assinatura será integrada (hoje mock manual) | Luís |
| Estrutura detalhada de produtos configuráveis | Quais produtos, quais características, genérico vs específico | A amadurecer |
| Oferta ao investidor | Produto de capital protegido/garantido, fundo de reserva, mecanismos de proteção | Vicente |

> **Princípio dos placeholders:** todo placeholder tem um **padrão funcional provisório** que roda de verdade — nunca um buraco que quebra. Cenários reais devem ser simuláveis de ponta a ponta mesmo nas áreas cuja regra final ainda não foi definida. A regra definitiva substitui o provisório sem refazer a estrutura ao redor.

---

*Documento vivo — atualizar a cada decisão validada.*
*Versão 2.0 — 2026-06-27 — expansão de escopo: originação absorvida do PopHub, distinção Acordo/Novação, telas do operador, refinamentos da reunião de 26/06 com Vicente.*
