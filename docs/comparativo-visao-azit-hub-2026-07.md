# Comparativo — Azit Hub (visão Vicente) × Azit Move V3 (construído)

> Documento de alinhamento, julho/2026. Cruza os dois documentos do Vicente — **"Domínios e Módulos Macro do Azit Hub"** e **"Definições que precisamos documentar antes de desenvolver o Azit Hub"** — com o que foi efetivamente construído no Azit Move V3. O objetivo não é decidir "quem acertou": é mostrar onde os desenhos coincidem, onde divergimos **de propósito** (e por quê), e onde o material do Vicente aponta lacunas reais que devemos incorporar.

## Leitura geral

Os dois desenhos descrevem **o mesmo sistema**. A lista de entidades do Vicente (pessoa, ativo, lead, simulação, proposta, contrato, parcela, recebimento, renegociação, quitação, aprovação, log de auditoria...) é, quase nome a nome, o schema que está em produção hoje. As diferenças reais são de três tipos:

1. **Modelagem** — algumas decisões estruturais nossas são diferentes do desenho dele (titular único vs. cadastros separados; cobrança centrada na conta vs. no contrato). São as divergências que merecem discussão de verdade.
2. **Ordem** — construímos numa sequência diferente da que ele propõe (núcleo financeiro antes da originação), por uma razão de negócio específica.
3. **Escopo** — coisas que ele prevê e que deliberadamente ainda não fizemos (ERP enxuto, bureaus, BI executivo, multi-empresa), e algumas em que já estamos **à frente** do MVP que ele imaginou (conciliação automática via Asaas, parâmetros versionados, motor de aprovação).

---

## Parte 1 — Os 10 domínios do Azit Hub, um a um

Legenda: ✅ construído · 🟡 parcial · ⏳ backlog registrado · ❌ fora de escopo deliberado

### 1. Plataforma, Governança e Segurança — 🟡

| Módulo (Vicente) | Status | No Azit Move hoje |
|---|---|---|
| Gestão de usuários | ✅ | Usuários com papéis (Admin, Operador, Aprovador, Diretor) |
| Perfis e permissões | 🟡 | Papéis existem e protegem operações críticas (parecer, aprovações, dev-only); **permissionamento fino tela a tela ainda não foi feito** — decisão explícita do Luís de adiar |
| Empresas e unidades de negócio | ❌ | Sistema é mono-empresa. Multi-empresa é mudança estrutural — só faz sentido quando o Grupo precisar de fato |
| Cadastros estruturantes / centros de custo | 🟡 | Centro de custo existe **por ativo** (gasto × recebido por veículo + visão de crédito avulso), desenhado para expandir |
| Parâmetros internos | ✅ | `VersaoParametrosSimulacao` — parâmetros **versionados**, nova configuração gera nova versão, contrato congela a versão usada. Exatamente o que o item 10 das Definições Prévias pede |
| Workflow de aprovações | ✅ | Motor de aprovação unificado: alçada configurável (matriz papel × operação), N aprovações, segregação solicitante ≠ decisor, recomendar/escalar, trilha completa |
| Auditoria / logs / rastreabilidade | 🟡 | `LogAuditoria` existe e cobre mudanças de parâmetro e aprovações; **a cobertura da lista do Vicente (baixa manual, alteração de vencimento, dados sensíveis...) ainda é parcial** |
| Notificações | 🟡 | In-app (toasts, badge de aprovações pendentes); cobrança externa via Asaas. Sem central de notificações |
| Segurança de acesso | ✅ | JWT, SPA 100% autenticada, guards por papel |

### 2. Pessoas, Cadastro e Dossiê — 🟡 (com divergência de modelagem — ver Parte 2)

O Vicente lista cadastros separados: clientes, investidores, fornecedores, colaboradores. Nós temos **um cadastro único — o Titular** — e os papéis (cliente, investidor) são **derivados do que a conta possui**, não entidades separadas. Esta é a Regra 8 do projeto e a divergência mais importante do documento — justificada na Parte 2.

- Dossiê da pessoa → 🟡 equivale à **ficha-hub do titular** (carteira, contratos, faturas, ações, renegociação, crédito — tudo parte da ficha). Histórico de relacionamento formal (timeline) não existe ainda.
- Fornecedores e colaboradores → ❌ não modelados (dependem do domínio 8, que não priorizamos).
- Documentos e pendências cadastrais → ✅ central de documentos por proposta e por ativo, com obrigatórios, pendências calculadas e download.

### 3. Originação Comercial — ✅ (núcleo) / 🟡 (CRM)

Construído como **Bloco 7 — originação nativa em telas**: Atendimento (nome, CPF, telefone, canal de origem) → Simulação V3 (motor real de precificação, ofertas fixas desenhadas + ofertas padrão + personalizada, validade de 7 dias, estados) → Proposta (Kanban) → conversão. É o funil que o Vicente descreve.

- CRM comercial completo (follow-up, tarefas, cadência) → 🟡 temos gestão de leads e retomada de simulação; CRM de verdade é evolução natural.
- Intake documental → ✅ na proposta (documentos obrigatórios por papel, gate para análise).

### 4. Análise de Cadastro e Decisão — 🟡

- Análise documental, parecer e aprovação → ✅ análise rica: anexos de embasamento, observação analítica, parecer em cards (aprovado / com ressalva / reprovado + motivos), papel Aprovador, garantidor exigível.
- Análise de capacidade de pagamento, consultas externas (bureaus), motor de decisão → ⏳ **placeholder deliberado (Regra 12)**: a decisão hoje é humana e estruturada; bureaus e motor automático entram quando a política de crédito estiver formalizada (o próprio Vicente estuda a ferramenta "Capivara"). O sistema roda de ponta a ponta sem eles — por desenho.
- Políticas de análise versionadas → ⏳ a infraestrutura de versionamento já existe (mesma mecânica dos parâmetros do simulador).

### 5. Ativos e Frota — 🟡

- Cadastro, disponibilidade/estoque, documentação veicular (arquivos por veículo), despesas por ativo (centro de custo), vínculo a oferta fixa → ✅.
- Manutenção e preparação (workflow de oficina), reentrada e revenda → ⏳ não construídos; a estrutura do centro de custo foi desenhada para expandir para isso.
- Proteção, rastreamento e bloqueio → 🟡 o **processo** existe no sistema (D+3 bloqueio absoluto, desbloqueio sempre manual, registrado); a **integração** com rastreador/bloqueador é futura — o próprio doc do Vicente também a coloca no futuro.

### 6. Contratos e Ativação — ✅

Domínio praticamente idêntico nos dois desenhos, e um dos mais maduros do sistema:

- Geração de contratos → ✅ motor de templates com dados × layout separados; o contrato oficial de compra e venda (17 cláusulas) é o template padrão.
- Formalização → ✅ com etapa de **parametrização** (data da 1ª parcela, decisão da reunião de 11/07).
- Assinatura digital → 🟡 assinatura interna (titular + Azit) funcional; plataforma externa (D4Sign etc.) e aceite item a item com log de IP/dispositivo estão desenhados em backlog (reunião 04/07).
- Checklist de ativação / ativação → ✅ contrato nasce "Aguardando assinatura", ativação **pelo pagamento da entrada** ("dia zero"), quando o cronograma inteiro nasce (parcelas + recebíveis + faturas) — Regra 2 do projeto.
- Geração da carteira → ✅ automática no dia zero.
- Aditivos → 🟡 cobertos hoje pelos mecanismos de Acordo (dilui atraso sem liquidar) e Novação (liquida e recria) — que mantemos como coisas **distintas** (Regra 5).

### 7. Carteira, Cobrança e Recuperação — ✅ (o mais construído de todos, com uma divergência de modelagem)

Quase todos os módulos do Vicente existem: gestão de carteira (visão titular-cêntrica com KPIs), parcelas, recebimentos e baixas automáticas, **conciliação automática via webhook do Asaas** (o MVP dele previa arquivo de retorno ou conciliação manual — aqui estamos à frente), agenda financeira do cliente (fatura consolidada), régua de cobrança (D-5 emissão, D+1/D+2 cobrança, D+3 bloqueio), renegociação com aprovação e entrada como aceite formal, quitação/antecipação com a fórmula do próprio Vicente (CR × PS com taxas próprias), encerramento com transferência do ativo.

A divergência: o Vicente organiza por contrato; nós somos **conta-cêntricos** — a fatura agrega parcelas de todos os contratos do titular, e a renegociação cobre a conta inteira. Justificado na Parte 2.

- Subledger da carteira → 🟡 recebíveis existem desde o dia zero por parcela; o **breakdown do recebível** (capital investidor × remuneração × serviço) está pendente do desenho do Sebastião + decisão "todo capital é de investidor" (11/07).
- Promessas de pagamento → ⏳ não modeladas como entidade.
- Encaminhamento jurídico → ⏳ processo manual, fora do sistema por ora.

### 8. Financeiro Administrativo / ERP Enxuto — ❌ deliberado

Contas a pagar, fornecedores, cotações, lotes de pagamento, BPO — **nada disso foi construído, de propósito**. Todo o esforço do V1 foi no **ciclo de receita** (originar → contratar → cobrar → receber → recuperar), que é onde o dinheiro e o risco do negócio estão. Despesa administrativa tem alternativas fora do sistema (BPO, planilha, banco); a carteira não tinha. A única ponta que antecipamos foi o **custo por ativo**, porque compõe a margem do veículo — e nasceu já dentro da estrutura de centro de custo que um dia recebe o resto do domínio 8.

### 9. Documentos, Assinaturas e Evidências — 🟡

Gestão de documentos (proposta, ativo, análise), modelos com dados × layout, download, checklist de obrigatórios → ✅. Versionamento documental formal e evidências operacionais como conceito transversal → ⏳. Assinatura digital externa → backlog (ver domínio 6).

### 10. Dados, BI e Performance — 🟡

KPIs operacionais existem nas telas (carteira, inadimplência, centro de custo). Dashboards executivos, indicadores consolidados e **relatórios para investidores** → ⏳ dependem justamente do breakdown do recebível e da visão investidor — que estão registrados como não priorizados até o desenho fechar. Construir BI antes do dado financeiro granular existir seria inverter a dependência.

---

## Parte 2 — As divergências de modelagem (o que fizemos diferente e por quê)

Estas são as diferenças que valem discussão com o Vicente — não são omissões, são decisões.

### 2.1 Titular único com papéis derivados (vs. cadastros de cliente / investidor / fornecedor separados)

**O que fizemos:** existe um único cadastro de pessoa — o **Titular**. "Cliente" e "investidor" não são entidades nem tipos de login: são papéis que emergem do que a conta da pessoa possui (um contrato de crédito a torna cliente; uma posição de capital a tornará investidora).

**Por quê:** a mesma pessoa física pode ser cliente hoje e investidora amanhã — no desenho de cadastros separados ela viraria dois registros com o mesmo CPF, com histórico, endereço e documentos duplicados e divergindo com o tempo. A visão de longo prazo do negócio (relacionamento de banco digital) exige enxergar a pessoa inteira. E há um ganho de LGPD: um único ponto de dados pessoais para proteger, retificar e expurgar.

**Convergência possível:** os "cadastros" do Vicente viram **visões filtradas** do titular (aba clientes = titulares com contrato; aba investidores = titulares com posição). A UI pode apresentar exatamente o que ele desenhou, sobre um dado só.

### 2.2 Cobrança centrada na Conta, não no contrato

**O que fizemos:** a fatura é da **conta** e agrega parcelas de todos os contratos do titular (veículo + seguro + crédito de manutenção = uma cobrança, um boleto). A renegociação também é da conta: levanta o atraso de todos os contratos numa única negociação.

**Por quê:** o cliente não paga "contratos", paga **uma fatura**. Na prática da cobrança, o motorista atrasado está atrasado na conta — renegociar contrato por contrato geraria N negociações paralelas com a mesma pessoa. Essa decisão veio da operação real (decisão de 03/07) e já corrigiu um bug concreto (parcelas novas geravam fatura separada em vez de consolidar).

**O que preservamos:** por baixo da fatura única, cada parcela continua pertencendo ao seu contrato e cada recebível ao seu credor — a visão por contrato (e futuramente por investidor) não se perde, é reconstruível a qualquer momento.

### 2.3 Ordem do roadmap: núcleo financeiro antes da originação

**O desenho do Vicente:** Fundação → **Originação** → Core → Cobrança → Recuperação → Integrações.

**O que fizemos:** Fundação → **Core financeiro + Cobrança** (sobre dados de seed e contratos legados) → Recuperação → **Originação por último** (Bloco 7) → integrações desde cedo.

**Por quê:** a empresa **já operava** — havia carteira legada cobrando via sistema antigo. O risco e o dinheiro estavam na cobrança, não na venda. Além disso, o funil de originação **termina** gerando um contrato ativo com cronograma: sem o núcleo financeiro pronto e validado, a originação desaguaria no vazio. E a integração com o Asaas não podia ficar para a "Fase 6" — cobrar era o objetivo do V1, então ela veio no início (com a regra de que **Asaas executa, Azit controla**: toda lógica vive no sistema, o Asaas só executa cobrança).

### 2.4 Recebível nasce no dia zero do contrato ativo

Decisão fina de modelagem que o documento macro do Vicente não desce a tratar, mas que estrutura tudo: o cronograma completo (parcelas + recebíveis + faturas) nasce **quando a entrada é paga**, não na formalização. Contrato assinado e não pago não gera carteira. Isso mantém a carteira limpa (só operação com dinheiro na mesa) e dá um "dia zero" inequívoco para juros, aniversário de IPCA e agenda do investidor.

### 2.5 A dívida independe do ativo

Sinistro ou furto do veículo não extingue a obrigação — parcela nunca é apagada (Regra 3). Alinha com o princípio "histórico financeiro imutável" das Definições Prévias: mesma tese, formulações diferentes.

### 2.6 Placeholder funcional, nunca buraco (Regra 12)

Onde o Vicente desenha módulos que dependem de política ainda não formalizada (motor de decisão, capacidade de pagamento, breakdown do recebível, alçadas definitivas), nós não esperamos a regra final: colocamos um **padrão provisório que roda, é testável e está marcado como substituível**. Por isso o sistema simula de ponta a ponta hoje, mesmo com regras "a definir". O documento dele descreve o alvo; o sistema caminha até lá sem parar em cada pendência de definição.

---

## Parte 3 — As "Definições Prévias", item a item

O segundo documento do Vicente pede 18 definições **antes de desenvolver**. O ponto interessante: **grande parte já foi feita — só que com outros nomes**. O projeto foi, desde o início, documentação-first (regra da casa: nenhuma linha de código antes de ler `docs/00` a `07`).

| # | Definição (Vicente) | Equivalente no Azit Move | Status |
|---|---|---|---|
| 1 | Visão do Produto | `docs/01-design-thinking` (problema, personas, core, não-escopo) | ✅ |
| 2 | Princípios de Arquitetura | As **14 Regras Invioláveis** do `CLAUDE.md` — sistema único modular ✓, histórico imutável ✓ (Regras 3 e 7), auditoria ✓, integração sem perder controle ✓ (Regra 1) | ✅ |
| 3 | Domínios e Módulos | `docs/02-dominio` é a **fonte da verdade**; módulos NestJS seguem os domínios; conflito código × doc é sinalizado, nunca resolvido em silêncio | ✅ (taxonomia diferente — ver abaixo) |
| 4 | Jornadas Macro | Jornadas existem descritas no doc 02 (originação, cobrança, acordo, quitação...), mas **não no formato estruturado** que ele propõe (eventos críticos, responsáveis, auditoria por jornada) | 🟡 |
| 5 | Modelo Macro de Dados | `docs/05-prisma-schema` + schema em produção. Das 21 entidades da lista dele, ~18 existem literalmente | ✅ |
| 6 | Fonte Oficial da Verdade | Regra 1 (Asaas executa, Azit controla) é exatamente isso; pagamento confirmado = Asaas conciliado via webhook no Azit ✓ | ✅ |
| 7 | Requisitos Não Funcionais | Existem espalhados (Decimal para dinheiro, webhook assíncrono, backup no plano de ambientes) mas **não consolidados num documento** | 🟡 **lacuna real** |
| 8 | Papéis, Permissões e Alçadas | Alçadas ✅ (matriz configurável); papéis ✅; **permissão fina por operação ⏳** (adiada por decisão) | 🟡 |
| 9 | Regras de Auditoria | `LogAuditoria` existe; a lista dele (baixa manual, alteração de vencimento, dados sensíveis...) é um **bom checklist do que falta cobrir** | 🟡 **lacuna real** |
| 10 | Políticas e Parâmetros versionados | `VersaoParametrosSimulacao` — implementado exatamente como ele descreve (versionado, com snapshot congelado por contrato) | ✅ |
| 11 | C4 Model | Não temos diagramas C4 | ⏳ barato de fazer, útil para a conversa |
| 12 | ADRs | As decisões **estão registradas** — datadas, com autor e racional, no doc 02 e no CLAUDE.md ("Decisão 2026-06-29, Luís: ..."). É um ADR de fato, sem o rótulo. Formalizar numa pasta `docs/adr/` é reorganização, não trabalho novo | 🟡 |
| 13 | Estratégia de Integrações | Convergente e **à frente** do MVP dele: cobrança/conciliação automática (Asaas) já operando; assinatura digital, bureaus, rastreador registrados como futuras — igual ao desenho dele | ✅ |
| 14 | Processo de Desenvolvimento com IA | Existe e funciona há meses: `CLAUDE.md` como contrato (a IA não decide domínio sozinha, decisão nova **sobe** pro doc 02 antes do código), marcos A–H com validação humana obrigatória, testes por entrega, migrations aditivas | ✅ |
| 15 | DoR / DoD | Praticado informalmente (item só entra com dependência pronta; só sai testado e documentado); **não escrito como DoR/DoD** | 🟡 |
| 16 | Desenvolvimento Seguro | Parcial: auth/autorização/criptografia ✓, LGPD por desenho ✓ (Regra 14 — investidor não vê dados pessoais do cliente); segregação de ambientes é o **plano dev/homolog/prod já desenhado e aguardando ordem de execução** | 🟡 |
| 17 | Roadmap por Fases | `docs/07-backlog` (blocos por dependência técnica, marcos A–H) — mesma ideia, ordem diferente e já executada (ver 2.3) | ✅ |
| 18 | Modelo de Operação da TI | Não documentado; hoje é uma pessoa + IA. O plano de ambientes/CI é o primeiro passo disso | ⏳ |

---

## Parte 4 — Síntese honesta

**Onde os desenhos convergem totalmente** (e isso valida os dois lados, porque foram feitos de forma independente): parâmetros versionados, workflow de aprovações com alçadas, fonte oficial da verdade, histórico financeiro imutável, cálculo financeiro no backend, sistema único modular, contrato→ativação→carteira como espinha dorsal, integrações graduais.

**Onde divergimos de propósito** (e devemos defender, ou pelo menos discutir com os argumentos na mesa): titular único com papéis derivados; cobrança conta-cêntrica; núcleo financeiro antes da originação; dia zero na ativação; placeholders funcionais no lugar de espera por definição.

**Onde o material do Vicente expõe lacunas reais nossas** (e vira, na prática, um roteiro de governança a incorporar):

1. **RNFs consolidados** num documento (item 7) — hoje estão implícitos.
2. **Cobertura de auditoria** usando a lista dele como checklist (item 9).
3. **Permissionamento fino** (item 8) — já reconhecido como pendência interna.
4. **Jornadas macro no formato estruturado** dele (item 4) — bom formato, vale adotar.
5. **C4 + ADRs formais** (itens 11–12) — reorganização barata do que já existe.
6. **DoR/DoD escritos** (item 15) e **modelo de operação de TI** (item 18).
7. **Segregação de ambientes** (item 16) — o plano existe e está em espera; este documento é um bom gatilho para destravá-lo.

**Proposta de convergência:** adotar a **taxonomia de 10 domínios do Vicente como camada de comunicação** (relatórios, conversas de negócio, organização de backlog futuro) — ela é boa e não conflita com nada — mantendo o `docs/02-dominio` como fonte da verdade técnica, com um mapeamento explícito entre os dois (que é essencialmente a Parte 1 deste documento). E sobre o nome: o que ele chama de **Azit Hub** e o que está no ar como **Azit Move V3** são o mesmo sistema — vale alinhar a marca antes que os dois nomes criem vida própria.

---

> **Nota pós-reunião (13/07):** este comparativo foi apresentado e discutido. Titular único e cobrança conta-cêntrica foram **validados**; a taxonomia de 10 domínios foi adotada como camada de comunicação; ficou definido que **Azit Hub** é a plataforma e **Azitmove** é a empresa. As lacunas viraram itens do backlog de 90 dias — RNFs, C4 e ADRs já foram entregues em `docs/rnf.md`, `docs/c4.md` e `docs/adr/` (14/07).
