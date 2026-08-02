# Requisitos — Gestão de Produtos v0.1 — Azit Hub

**Data:** 02/08/2026 · **Status:** rascunho para validação do Vicente · **Autor:** Luís / assistente

**Fontes:** Modelo de Gestão de Produtos; Contexto e Racional; Catálogo de Produtos; planilhas Compra Parcelada, Reembolso Parcelado e Proteção Veicular (fórmulas extraídas célula a célula).

Este documento traduz os artefatos de produto em requisitos implementáveis, no mesmo formato do documento de Análise de Cadastro. O que estiver marcado como **[PERGUNTA]** precisa de definição antes (ou durante) a fase correspondente — nada disso trava a Fase 1.

---

## 1. Escopo e faseamento

| Fase | Entrega | Depende de |
|---|---|---|
| **F1 — Fundação** | Entidades Produto → Variante → Versão com parâmetros, herança e ciclo de vida; tela de gestão na área Produtos | Validação deste documento |
| **F2 — Simulador consome o Produto** | Simulador de Compra Parcelada passa a ler parâmetros da versão vigente do produto (hoje os parâmetros vivem no próprio simulador) | F1 |
| **F3 — Reembolso Parcelado** | Produto novo completo: simulação, contratação, cobrança junto ao contrato principal | F1 |
| **F4 — Antecipação por componente** | Rework da antecipação: desconto por componente (bem, comissão, proteção) com taxas e isenções da versão do produto | F2 |
| **F5 — Proteção Veicular** | Produto estrutural (autônomo ou vinculado), contribuição por variante e oferta | F1 + homologação dos valores |
| **F6 — Cronograma por componentes + frequência diária** | Parcela aberta em componentes no cronograma, imputação de pagamento por componente, frequência diária | F2, F3 |

Ordem proposta: F1 → F2 → F3 (prioridade de negócio) → F4 → F5 → F6.

---

## 2. Modelo de gestão (transversal)

- **RF-G01.** Hierarquia **Produto → Variante → Versão**. O produto define a natureza (ex.: Compra Parcelada); a variante segmenta (Carro, Moto, Outro; Leves, Duas Rodas, Utilitários); a versão congela o conjunto de parâmetros vigente.
- **RF-G02.** **Herança com sobrescrita**: parâmetro definido no nível Global vale para todos os produtos; no nível Produto, para todas as variantes; a variante pode sobrescrever. A tela mostra sempre de onde o valor efetivo veio (herdado × sobrescrito).
- **RF-G03.** **Versionamento**: alteração **material** (qualquer parâmetro que afete preço, prazo, encargo ou regra de cálculo) gera nova versão com numeração sequencial e vigência; alteração **cadastral** (nome, descrição, textos) não versiona. Contratos existentes permanecem presos à versão com a qual foram contratados — nunca recalcular operações passadas.
- **RF-G04.** **Ciclo de vida** do produto e da variante: Rascunho → Ativo ⇄ Suspenso → Encerrado. Só produto/variante Ativo aparece para simulação e venda. Suspenso interrompe vendas novas sem afetar contratos vigentes.
- **RF-G05.** **Oferta não é entidade**: ofertas padrão (1, 2, 3) são conjuntos de parâmetros da variante (prazo, frequência, entrada), editáveis na gestão do produto. A oferta personalizada é calculada com os mesmos parâmetros.
- **RF-G06.** **Governança sem workflow de aprovação**: a Diretoria gere produtos diretamente (permissão da área Produtos + auditoria completa de quem alterou o quê, antes/depois). Não há trilha de aprovação para mudar parâmetro.
- **RF-G07.** **Produto é a fonte da verdade; o simulador é consumidor.** Nenhum parâmetro financeiro pode viver apenas no simulador.
- **RF-G08.** **Nomes por extenso em tela.** Siglas (TR, CI, CR, ICVF…) são código interno; toda tela exibe o nome completo ("Comissão recorrente por período", nunca "CRF").

---

## 3. Produto 1 — Compra Parcelada

### 3.1 Parâmetros (versão inicial, conforme planilha)

| Parâmetro | Carro | Moto | Outro |
|---|---|---|---|
| Entrada mínima | R$ 3.990 | R$ 990 | R$ 1.990 |
| Prazo mínimo / máximo (meses) | 12 / 60 | 6 / 36 | 6 / 48 |
| Taxa mensal de remuneração do capital | 1,7% | 3,0% | 2,0% |
| Comissão inicial de consignação | R$ 3.990 | R$ 1.990 | R$ 2.990 |
| Comissão recorrente mensal | R$ 799,96 | R$ 399,96 | R$ 399,96 |
| Taxa mensal de desconto do bem por antecipação | 1,6% | 2,0% | 1,8% |
| Taxa de desconto da comissão por antecipação | 0% (sem desconto) | 0% | 0% |
| Isenção da comissão recorrente na liquidação antecipada | Sim | Sim | Sim |
| Proteção veicular | Obrigatória | Obrigatória | — |
| Modelo de contrato | CNTC003 | CNTM001 | CNTO001 |

Gerais: atualização monetária IPCA; multa 2%; juros de mora 1% a.m. pró-rata (dias/30); meio de pagamento PIX; 3 ofertas padrão por variante (prazo + frequência + entrada).

### 3.2 Cálculo da simulação

- **RF-CP01.** Valor do parcelamento = Valor à vista + Comissão inicial − Entrada.
- **RF-CP02.** Parcela mensal do bem pelo Sistema Price sobre o valor do parcelamento, com a taxa mensal de remuneração e o prazo em meses.
- **RF-CP03.** Conversão para a frequência pelo **índice de conversão de valor** (Mensal 1, Quinzenal 2, Semanal 4, Diária 28): parcela do bem por período = parcela mensal ÷ índice. O mesmo índice divide a comissão recorrente e a proteção mensal.
- **RF-CP04.** Parcela total do período = parcela do bem + comissão do período + proteção do período (se obrigatória), arredondada a 2 casas.
- **RF-CP05.** Validações de entrada mínima e prazo mín/máx são **avisos informativos, não bloqueiam** a simulação (conforme planilha). **[PERGUNTA 6]** confirmar se na contratação passam a bloquear.
- **RF-CP06.** **Caso de ouro (teste de aceite):** HB20S, valor à vista R$ 50.000, entrada R$ 1.990, 36 meses, semanal → parcela total R$ 743,24 por semana; 156 parcelas; parcela do bem por período R$ 428,93 na visão do cronograma; total do contrato R$ 117.935,47.

### 3.3 Entrada × comissão inicial e cronograma

- **RF-CP07.** A entrada quita primeiro a comissão inicial: entrada compensada = mínimo(entrada, comissão inicial); entrada sobre o bem = máximo(entrada − comissão inicial, 0).
- **RF-CP08.** Se a comissão inicial for maior que a entrada, o **saldo de comissão inicial** é cobrado nas primeiras parcelas: número de parcelas integrais = inteiro(saldo ÷ parcela do bem por período), mais um resíduo na parcela seguinte; as parcelas do bem ficam **deslocadas** esse número de períodos.
- **RF-CP09.** Diferenças de arredondamento do bem são ajustadas na **primeira** parcela do bem (na Compra Parcelada; no Reembolso Parcelado é na última).
- **RF-CP10.** O cronograma é **por componentes**: cada parcela discrimina bem, comissão e proteção; a imputação de pagamento parcial segue a ordem **comissão → bem → proteção**.
- **RF-CP11.** Duas visões do cronograma: administrativa (todos os componentes abertos) e do cliente (parcela total e composição resumida).

---

## 4. Produto 2 — Reembolso Parcelado

Pagamento parcelado de despesas elegíveis do veículo, para cliente com contrato ativo (evolui o crédito de manutenção existente).

### 4.1 Parâmetros

| Parâmetro | Valor |
|---|---|
| Valor mínimo / máximo da operação | R$ 300 / R$ 5.000 |
| Prazo máximo | 12 meses (26 quinzenas / 52 semanas / 365 dias) |
| Valor mínimo da parcela | R$ 50 |
| Encargo mensal do processamento | 19,99% a.m. |
| Taxa inicial de processamento | 9,99%, mínimo R$ 99,90 |
| Limite da parcela acessória | 30% da parcela do contrato principal |
| Atualização monetária | Não aplicável |
| Multa / juros de mora | 2% / 1% a.m. pró-rata |
| Cobrança | **No mesmo boleto/PIX do contrato principal** |

### 4.2 Regras

- **RF-RP01.** Cálculo pelo Sistema Price com **taxa equivalente à frequência**: taxa do período = (1 + taxa mensal)^(dias do intervalo ÷ 30) − 1. **Não** dividir a parcela mensal pelo índice de valor (regra explícita da planilha — diferente da Compra Parcelada, que divide; a diferença é intencional por produto).
- **RF-RP02.** Conversão de prazo pelo **índice de conversão de prazo** (Mensal 1; Quinzenal 2,1726; Semanal 4,3452; Diária 30,4164); máximo de parcelas por frequência = prazo máximo × índice.
- **RF-RP03.** Taxa inicial de processamento entra no valor financiado; respeitar o mínimo de R$ 99,90.
- **RF-RP04.** A parcela do reembolso não pode ultrapassar **30% da parcela do contrato principal** — validação na simulação e na contratação.
- **RF-RP05.** Ajuste de arredondamento na **última** parcela.
- **RF-RP06.** Liquidação antecipada com desconto proporcional dos encargos futuros (valor presente das vincendas à própria taxa do produto).
- **RF-RP07.** A cobrança consolida na fatura do contrato principal (a infraestrutura de consolidação já existe no sistema).
- **RF-RP08.** Ofertas padrão do MVP: R$ 1.000 em 12 semanas; R$ 2.500 em 24 semanas; R$ 5.000 em 36 semanas.

---

## 5. Produto 3 — Proteção Veicular

Produto complementar, **autônomo ou vinculado** ao contrato de Compra Parcelada. Valores atuais são **proposta para homologação** — não comercializar antes do OK.

- **RF-PV01.** Contribuição mensal = **máximo(contribuição mínima da variante; FIPE × taxa da oferta) + taxa fixa de administração + custo de assistência + acréscimo por perfil**.
- **RF-PV02.** Variantes: Leves (mín. R$ 199,96), Duas Rodas (mín. R$ 99,96), Utilitários (mín. R$ 299,96). Ofertas: Essencial (0,35% FIPE, roubo e furto), Proteção (0,50%, + colisão), Completa (0,65%, coberturas ampliadas + assistência R$ 39,90). Administração fixa R$ 29,90 em todas.
- **RF-PV03.** Vigência padrão 12 meses; frequências Mensal/Quinzenal/Semanal/Diária; conversão pelo índice de valor.
- **RF-PV04.** Cancelamento antecipado: cessam as contribuições futuras (sem multa, sem devolução) — coerente com a regra de isenção da proteção na liquidação total do contrato principal.
- **RF-PV05.** Quando vinculada à Compra Parcelada, a contribuição compõe a parcela total e o componente proteção do cronograma; quando autônoma, tem cobrança própria.
- **RF-PV06.** Reajuste anual por IPCA com revisão técnica.

---

## 6. Datas, cobrança e janelas (comum aos três produtos)

- **RF-DC01.** Prazo máximo entre assinatura e ativação: **5 dias**.
- **RF-DC02.** Prazo máximo até o primeiro vencimento, por frequência: Mensal **59** dias, Quinzenal **27**, Semanal **13**, Diária **2**.
- **RF-DC03.** Intervalo entre vencimentos: 30 / 14 / 7 / 1 dias; na frequência mensal, vencimento no mesmo dia do mês (equivalente ao EDATE da planilha).
- **RF-DC04.** Base mensal de 30 dias para pró-rata e equivalência; multa 2% fixa; juros de mora 1% a.m. proporcional (dias de atraso ÷ 30).
- **RF-DC05.** Frequência **Diária** é nova no sistema (hoje: mensal, quinzenal, semanal) — entra na F6.

---

## 7. Antecipação e liquidação (rework da regra atual)

- **RF-AL01.** Desconto de antecipação **por componente**, com taxa própria da versão do produto: bem (taxa de desconto do bem), comissão (taxa própria — hoje 0% = antecipa sem desconto), proteção (taxa própria — hoje 0%).
- **RF-AL02.** Valor presente de cada componente = valor ÷ (1 + taxa)^(dias ÷ 30) — mesma matemática já implementada, trocando a origem das taxas para a versão do produto.
- **RF-AL03.** **Liquidação total antecipada**: isenta comissão recorrente e proteção futuras (parâmetro "Sim" da versão). **Antecipação parcial**: cobra comissão e proteção **cheias** das parcelas antecipadas.
- **RF-AL04.** Reembolso Parcelado: liquidação a valor presente pela taxa do próprio produto (19,99% a.m.).

---

## 8. Divergências com o sistema atual (para decidir na F2)

1. **Parâmetros no simulador** → migram para a versão do produto (é o objetivo da F2).
2. **Fator semanas/mês**: sistema usa 4,345 (decisão de 04/07); catálogo usa índice de valor 4 (divisão da parcela) e índice de prazo 4,3452 (conversão de prazo). São conceitos diferentes que hoje estão fundidos no sistema — a F2 precisa separar. **[PERGUNTA 8]**
3. **Antecipação atual** usa taxa de desconto da comissão de 20% a.m. e a taxa de remuneração congelada para proteção — o catálogo zera as duas e isenta na liquidação total. Rework na F4.
4. **Vencimento na segunda-feira para motoristas** (decisão de 04/07) não aparece no catálogo — assumimos que continua valendo como regra operacional de agenda. Confirmar.

---

## 9. Perguntas abertas

1. **Status e vigência das versões**: a numeração sequencial de versão começa em qual estado para os produtos já operando? Migramos os contratos atuais como "versão 1"?
2. **Proteção Veicular — homologação**: quem homologa os valores (taxas, administração, assistência, Utilitários) e até quando?
3. **Coberturas da proteção**: o resumo (roubo/furto/colisão/ampliadas) basta para o contrato ou existe documento de coberturas por oferta?
4. **Instrumento jurídico do Reembolso Parcelado**: aditivo ao contrato principal ou instrumento próprio?
5. **Proteção na Compra Parcelada**: para a variante Outro (sem proteção obrigatória), o cliente pode aderir opcionalmente?
6. **Avisos × bloqueios**: entrada abaixo da mínima e prazo fora da faixa não bloqueiam a simulação — bloqueiam a contratação?
7. **IPCA**: fonte oficial (a planilha cita a calculadora cidadã do Banco Central) e momento de aplicação do reajuste.
8. **Precisão dos fatores**: 4,3452 (catálogo) × 4,345 (decisão de 04/07) × 2,17 (quinzenal atual) — padronizar qual valor e onde cada um se aplica.
9. **Visão do cliente/membro**: a visão espelhada do cronograma (planilha "Membro") está no escopo do MVP ou fica para o portal do titular?

---

*Azit Hub — v0.1 para validação — 02/08/2026*
