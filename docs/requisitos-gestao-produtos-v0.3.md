# Requisitos — Gestão de Produtos v0.3 — Azit Hub

**Data:** 03/08/2026 · **Status:** v0.3 — todas as perguntas do Luís respondidas (02–03/08); segue para validação do Vicente · **Autor:** Luís / assistente

**Fontes:** Modelo de Gestão de Produtos; Contexto e Racional; Catálogo de Produtos; planilhas Compra Parcelada, Reembolso Parcelado e Proteção Veicular (fórmulas extraídas célula a célula); decisões de 02/08/2026.

**O que mudou até a v0.3:** v0.2 incorporou as decisões 1, 3, 6, 7 e 8; a v0.3 fecha as perguntas 4 (condição fora da faixa segue com alçada — ponto de atenção) e 5 (instrumento próprio vinculado à conta). A Fase 1 (fundação Produto → Variante → Versão) **já está construída** — os três produtos estão cadastrados no sistema em situação Rascunho, com os parâmetros das planilhas, sem nenhum efeito sobre o simulador atual.

---

## 0. Decisões incorporadas nesta versão

| # | Tema | Decisão (Luís, 02/08) |
|---|---|---|
| 1 | Numeração de versão | Formato **V1, V2, V3…**, sequencial **por produto e por variante** (cada nível tem a sua sequência). Já implementado assim. |
| 3 | Proteção dentro da Compra Parcelada | A cobrança da proteção **acompanha a frequência do contrato**. A referência de preço é **semanal**: contrato semanal cobra o valor semanal; contrato mensal cobra o valor semanal × fator semana→mês. Ver RF-CP12. |
| 6 | IPCA | Fonte/integração fica **em aberto**; placeholder funcional segue valendo. |
| 7 | Fatores de conversão | **Seguir o Catálogo**: índice de conversão de prazo 4,3452 (semanal) e 2,1726 (quinzenal). Vale como padrão único do sistema a partir da F2; o parâmetro da análise de cadastro (hoje 4,345) será atualizado por nova versão de parâmetros na mesma virada. |
| 4 | Condição fora da faixa | **Opção (b): deixa simular e seguir**, com a proposta marcada "fora do parâmetro" e exigindo **aprovação de alçada superior** antes de formalizar. ⚠️ **PONTO DE ATENÇÃO (Luís, 03/08): decisão pode ser revista** — implementar como parâmetro configurável do produto (bloquear × seguir com alçada), para trocar sem código. |
| 5 | Instrumento do Reembolso Parcelado | **Contrato à parte, com natureza de TERMO**, vinculado à **conta do cliente** na Azitmove — não ao contrato do veículo. Elegibilidade continua exigindo contrato ativo, mas o instrumento é próprio (coerente com a arquitetura conta-cêntrica: o mesmo padrão do acordo de renegociação). |
| 8 | Visão do cliente ("Membro") | **Desenhar agora, sem desenvolver**: será produzida uma proposta de telas (mockup) da visão do cliente para validação, antes de qualquer código. Entra como entregável de design na F6. |

Continuam **em aberto** (sem bloquear as fases 1–3): homologação da Proteção Veicular (pergunta 2) e os fatores da proteção nas frequências quinzenal/diária (pergunta 10).

---

## 1. Escopo e faseamento

| Fase | Entrega | Situação |
|---|---|---|
| **F1 — Fundação** | Produto → Variante → Versão com herança, versionamento material e ciclo de vida; tela de gestão na área Produtos | **CONSTRUÍDA** (02/08). Produtos em Rascunho; numeração V1, V2…; auditoria completa |
| **F2 — Simulador consome o Produto** | Simulador de Compra Parcelada lê os parâmetros da versão vigente do catálogo; adoção dos fatores 4,3452/2,1726 como padrão único | Aguarda validação deste documento |
| **F3 — Reembolso Parcelado** | Produto novo completo: simulação, contratação, cobrança na fatura do contrato principal | Aguarda F2 |
| **F4 — Antecipação por componente** | Desconto por componente (bem, comissão, proteção) com taxas e isenções da versão do produto | Aguarda F2 |
| **F5 — Proteção Veicular** | Produto estrutural (autônomo ou vinculado), contribuição por variante e oferta | Aguarda homologação dos valores (pergunta 2) |
| **F6 — Cronograma por componentes + diária + visão do cliente (design)** | Parcela aberta em componentes, imputação por componente, frequência diária; **desenho** da visão do cliente (sem desenvolvimento) | Aguarda F2/F3 |

---

## 2. Modelo de gestão (transversal)

- **RF-G01.** Hierarquia **Produto → Variante → Versão**. O produto define a natureza (ex.: Compra Parcelada); a variante segmenta (Carro, Moto, Outro; Leves, Duas Rodas, Utilitários); a versão congela o conjunto de parâmetros vigente.
- **RF-G02.** **Herança com sobrescrita**: parâmetro no nível produto vale para todas as variantes; a variante sobrescreve chave a chave. A tela mostra a origem de cada valor (herdado × sobrescrito).
- **RF-G03.** **Versionamento**: alteração **material** (preço, prazo, encargo ou regra de cálculo) gera versão nova — numeração **V1, V2, V3…**, sequencial por produto e por variante — e encerra a vigência da anterior; alteração **cadastral** (nome, descrição) não versiona. Contratos permanecem presos à versão contratada — nunca recalcular o passado.
- **RF-G04.** **Ciclo de vida**: Rascunho → Ativo ⇄ Suspenso → Encerrado. Só Ativo aparece para simulação e venda.
- **RF-G05.** **Oferta não é entidade**: as condições padrão são parâmetros da variante.
- **RF-G06.** **Governança sem workflow**: Diretoria gere diretamente (permissão da área Produtos + auditoria de quem alterou o quê, antes/depois, com motivo obrigatório).
- **RF-G07.** **Produto é a fonte da verdade; o simulador é consumidor** (efetivado na F2).
- **RF-G08.** **Nomes por extenso em tela.** Siglas são código interno.

---

## 3. Produto 1 — Compra Parcelada

### 3.1 Parâmetros (versão V1, conforme planilha — já cadastrados no sistema)

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
| Proteção veicular | Obrigatória | Obrigatória | — (pergunta 3b) |
| Modelo de contrato | CNTC003 | CNTM001 | CNTO001 |

Gerais (nível produto): atualização monetária IPCA; multa 2%; juros de mora 1% a.m. pró-rata (dias/30); meio de pagamento PIX; janelas de ativação e primeiro vencimento (seção 6); 3 condições padrão por variante.

### 3.2 Cálculo da simulação

- **RF-CP01.** Valor do parcelamento = Valor à vista + Comissão inicial − Entrada.
- **RF-CP02.** Parcela mensal do bem pelo Sistema Price (taxa mensal de remuneração, prazo em meses).
- **RF-CP03.** Conversão para a frequência pelo **índice de conversão de valor** (Mensal 1, Quinzenal 2, Semanal 4, Diária 28) para o bem e para a comissão recorrente.
- **RF-CP04.** Parcela total do período = bem + comissão + proteção do período, arredondada a 2 casas.
- **RF-CP05 (DECIDIDA 03/08).** Entrada abaixo da mínima ou prazo fora da faixa **não bloqueiam** a simulação: a proposta segue marcada **"fora do parâmetro"** e exige **aprovação de alçada superior** antes da formalização (via motor de aprovação existente, tipo de operação próprio). ⚠️ Ponto de atenção: o comportamento (bloquear × seguir com alçada) será um **parâmetro configurável do produto**, porque a decisão pode ser revista.
- **RF-CP06.** **Caso de ouro (teste de aceite):** HB20S, R$ 50.000, entrada R$ 1.990, 36 meses, semanal → parcela total R$ 743,24 por semana; 156 parcelas; total R$ 117.935,47.
- **RF-CP12 (NOVA — decisão 02/08).** **Proteção dentro da Compra Parcelada:** a cobrança da proteção acompanha a **frequência do contrato**, e a referência de preço é **semanal**:
  - contrato semanal → cobra o valor semanal da proteção;
  - contrato mensal → cobra valor semanal × **fator semana→mês (4,3452)**;
  - contrato quinzenal → valor semanal × 2 *(a confirmar — derivado dos índices do Catálogo: 4,3452 ÷ 2,1726)*;
  - contrato diário → valor semanal ÷ 7 *(a confirmar)*.
  - Consequência: o parâmetro definitivo do catálogo passa a ser a **proteção semanal** por variante/oferta (a fonte é o produto Proteção Veicular); o valor mensal deixa de ser a base. Os valores atuais na V1 vieram da planilha (base mensal, mocados) e serão substituídos quando a Proteção Veicular for homologada.

### 3.3 Entrada × comissão inicial e cronograma

*(sem mudanças — RF-CP07 a RF-CP11 conforme v0.1: entrada quita primeiro a comissão inicial; saldo cobrado nas primeiras parcelas com deslocamento; ajuste de arredondamento na primeira parcela do bem; cronograma por componentes com imputação comissão → bem → proteção; duas visões.)*

---

## 4. Produto 2 — Reembolso Parcelado

*(sem mudanças em relação à v0.1 — parâmetros e RF-RP01 a RF-RP08 mantidos: Price com taxa equivalente à frequência — (1+taxa mensal)^(dias÷30)−1 —, índice de prazo 4,3452/2,1726, taxa inicial mínima R$ 99,90, limite de 30% da parcela principal, ajuste na última parcela, liquidação a valor presente, cobrança na fatura do contrato principal.)*

- **RF-RP09 (NOVA — decisão 03/08).** Instrumento: **contrato próprio com natureza de termo**, vinculado à **conta do titular** (não ao contrato do veículo). A elegibilidade exige contrato ativo, mas a vida do reembolso é independente da do contrato âncora — a dívida vive na conta (mesma lógica conta-cêntrica do acordo). Modelo de documento próprio (código a definir com o jurídico, ex.: TRP001).

---

## 5. Produto 3 — Proteção Veicular

*(sem mudanças em relação à v0.1 — RF-PV01 a RF-PV06 mantidos.)* Valores seguem **proposta para homologação** (pergunta 2, em aberto — sem prazo definido). Com a decisão RF-CP12, o preço de referência por variante/oferta passa a ser expresso **por semana** além de por mês.

---

## 6. Datas, cobrança e janelas

*(sem mudanças — ativação em até 5 dias; primeiro vencimento 59/27/13/2; intervalos 30/14/7/1 com mensal em dia fixo; base 30 dias; multa 2% + juros 1% a.m. pró-rata.)*

---

## 7. Antecipação e liquidação

*(sem mudanças — desconto por componente com taxas da versão do produto; isenção de comissão e proteção na liquidação total; parcial cobra cheio; Reembolso Parcelado liquida a valor presente pela taxa do próprio produto.)*

---

## 8. Divergências com o sistema atual

1. **Parâmetros no simulador** → migram para a versão do produto na F2 (decidido).
2. **Fatores de conversão** → **DECIDIDO (02/08): seguir o Catálogo** — 4,3452 semanal e 2,1726 quinzenal como padrão único a partir da F2. A análise de cadastro atualiza seu parâmetro (4,345 → 4,3452) por nova versão de parâmetros na mesma virada; contratos e análises já feitos não são recalculados.
3. **Antecipação atual** (desconto de 20% a.m. na comissão) → rework na F4 conforme catálogo (comissão sem desconto + isenção na liquidação total).
4. **Vencimento na segunda-feira para motoristas** (04/07): assumido como regra operacional de agenda que convive com o catálogo. Confirmar.

---

## 9. Perguntas que permanecem abertas

**2. Proteção Veicular — homologação** *(em aberto, sem resposta agora)*: valores (taxas, administração, assistência, Utilitários), coberturas de verdade (limites, franquias, carências, exclusões, sinistro) e instrumento jurídico.

**Nova — 10. Fatores da proteção nas demais frequências** (derivada da decisão 3): confirmar quinzenal = semanal × 2 e diária = semanal ÷ 7, ou definir outros fatores.

---

*Azit Hub — v0.2 — decisões de 02/08 incorporadas — para validação*
