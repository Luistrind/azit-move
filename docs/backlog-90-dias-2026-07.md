# Backlog de 90 dias — Azit Hub

> Proposta de 13/07/2026, para revisão em tela na reunião de 14/07. Horizonte: **14/07 → 11/10/2026**, em três ondas de ~30 dias. Nomenclatura conforme alinhado: **Azit Hub** é a plataforma; **Azitmove** é a empresa.
>
> O que este documento faz de diferente do `07-backlog.md` (a esteira técnica original, já concluída): distingue **feito × pendente × futuro**, separa **item técnico** (executa direto) de **item que depende de regra estratégica** (precisa de definição de negócio antes do código), e nomeia o responsável pela definição — para que as decisões de produto não fiquem concentradas numa pessoa só.

---

## O que já está FEITO (base sobre a qual os 90 dias constroem)

Esteira V1 completa, em produção: originação nativa (atendimento → simulação V3 com parâmetros versionados e ofertas fixas → proposta → análise com parecer estruturado → formalização com contrato oficial → ativação pela entrada no dia zero); carteira conta-cêntrica com fatura consolidada; cobrança e conciliação automáticas via Asaas (webhook assíncrono); régua D-5/D+1/D+2/D+3; acordo (conta) e novação; quitação/antecipação com decomposição CR×PS; crédito de manutenção com alçada; motor de aprovação unificado; centro de custo por ativo (v1); documentos por proposta e por ativo; mobile responsivo.

---

## Regras de negócio pendentes (trilha paralela — não consome desenvolvimento, mas destrava itens técnicos)

| # | Definição | Responsável | Destrava (item) |
|---|---|---|---|
| R1 | Antecipação por natureza do item — regra por produto (carro / seguro / CR / serviços); planilha em evolução | Vicente | T3 |
| R2 | Política de crédito formalizada | Vicente + time de crédito | T10, T11 |
| R3 | Novo produto: parcelamento de despesas — fluxo e contabilidade próprios (não é centro de custo, não é RP) | Vicente (pesquisa/modelagem) | T12, T13 |
| R4 | Critérios de alçada por produto + casos "fora do parâmetro sobe para 2ª aprovação" | Vicente + Luís | T6 |
| R5 | "Todo capital é de investidor" — fechamento da modelagem financeira do recebível | Sebastião | T14, T18 |
| R6 | O que o investidor vê: métricas, visões, limites de LGPD | Vicente (apoio técnico Luís) | T17 |
| R7 | Escolha da plataforma de assinatura digital (D4Sign/DocuSign/etc.) | Diretoria | T9 |

---

## Onda 1 — Fundação de governança e correções (14/07 → ~15/08)

Objetivo: destravar a homologação formal e fechar as lacunas apontadas no comparativo que não dependem de regra de negócio.

| # | Item | Domínio | Tipo | Situação hoje |
|---|---|---|---|---|
| T1 | **Segregação de ambientes** dev/homolog/prod + CI/CD + backup/rollback por tag | Plataforma | Técnico | Plano pronto, em espera — a reunião foi o gatilho |
| T2 | **Homologação do simulador** com Vicente + ajustes decorrentes | Originação | Negócio + técnico | Agendada; parâmetros/fatores já configuráveis |
| T3 | **Antecipação por natureza do item** — seguro nunca isenta com cobertura vigente; regra por produto | Carteira/Cobrança | Depende de **R1** | Fórmula CR×PS pronta para a parcela do veículo; falta a distinção por natureza |
| T4 | **Auditoria de eventos sensíveis** — baixa manual (responsável + evidência), alteração de vencimento, dados sensíveis | Plataforma | Técnico | LogAuditoria existe; cobertura parcial |
| T5 | **Central de parâmetros por fluxo/produto** — remodelar tela: simulação de ativo ≠ produto financeiro ≠ renegociação, camadas independentes | Plataforma | Técnico | Parâmetros versionados prontos; organização por fluxo pendente |
| T6 | **Alçadas por produto + retrabalho do front da matriz** + fluxo "fora do parâmetro sobe em vez de rejeitar" | Plataforma | Técnico + **R4** | Motor pronto; front atual é provisório |
| T7 | **Correções de usabilidade** — máscara de milhar BR (km/valores) e pequenos ajustes acumulados | Transversal | Técnico | Bug conhecido |
| T8 | **Documentação de governança (1ª leva)** — RNFs consolidados + C4 Model + pasta `docs/adr` formalizando decisões existentes | Plataforma | Técnico/doc | Conteúdo existe espalhado; é consolidação |

## Onda 2 — Produto e crédito (~15/08 → ~15/09)

Objetivo: transformar as definições de negócio da trilha paralela em funcionalidade; avançar formalização digital.

| # | Item | Domínio | Tipo | Situação hoje |
|---|---|---|---|---|
| T9 | **Assinatura digital efetiva** — aceite item a item (log de IP/dispositivo/data por cláusula) + integração com plataforma externa | Contratos | Técnico + **R7** | Caminho interno pronto; falta integração |
| T10 | **Análise de capacidade de pagamento** — substituir placeholder pela regra da política de crédito | Análise/Decisão | Depende de **R2** | Placeholder funcional |
| T11 | **Consultas externas / birô** — integração conforme política | Análise/Decisão | Depende de **R2** | Não iniciado (decisão: só após política) |
| T12 | **Produto de parcelamento de despesas** — fluxo, simulação e contabilidade próprios | Produtos | Depende de **R3** | Crédito de manutenção atual é o embrião |
| T13 | **Revisão do centro de custo** — restringir a despesas do dono do ativo; separar visões dono × prestador | Ativos/Frota | Técnico + **R3** | v1 construída; correção conceitual da reunião 13/07 |
| T14 | **Breakdown do recebível** — capital investidor × remuneração × serviço em cada recebível | Capital/Investimento | Depende de **R5** | Recebíveis desde o dia zero prontos; falta a decomposição |
| T15 | **Permissionamento fino** — matriz de permissões por operação/tela | Plataforma | Técnico | Papéis e guards básicos prontos |
| T16 | **Jornadas macro estruturadas** (formato Vicente: eventos críticos, responsáveis, auditoria) + DoR/DoD escritos | Plataforma | Técnico/doc | Jornadas descritas no doc 02 sem o formato |

## Onda 3 — Visões e relacionamento (~15/09 → 11/10)

Objetivo: abrir o sistema para fora (investidor) e enriquecer a visão interna do cliente.

| # | Item | Domínio | Tipo | Situação hoje |
|---|---|---|---|---|
| T17 | **Portal único com visões por perfil — 1º módulo: visão do investidor** (financeira, anonimizada por LGPD) | Capital/Investimento | Depende de **R6** + T14 | Decisão de portal único tomada; regras a definir |
| T18 | **BI / dashboards executivos** — indicadores de carteira, inadimplência, frota, financeiros | Dados/BI | Técnico (após T14) | KPIs operacionais existem; BI congelado aguardando modelagem financeira |
| T19 | **Central de notificações por usuário** | Plataforma | Técnico | Só toasts + badge de aprovações |
| T20 | **Timeline do cliente** na ficha-hub (histórico de relacionamento organizado) | Pessoas/Dossiê | Técnico | História reconstruível por datas; sem visualização |
| T21 | **CRM comercial (1ª etapa)** — follow-up e tarefas sobre leads/simulações | Originação | Técnico | Leads e retomada prontos; sem cadência |

---

## Registrado como FUTURO (fora dos 90 dias — não entra sem novo desenho)

- Internalização do rastreamento (compra de equipamento próprio vs. Inflit; viabiliza moto, bike, máquinas) — **avaliação econômica: Cláudio + Luís, pode correr em paralelo**;
- Multiempresa / unidades do Grupo Azit (Educação, Imóvel, Capital);
- Portal do cliente (módulo do titular no portal único);
- ERP/RP e CRM completos como integrações externas (mapear opções: Cláudio + equipe);
- Manutenção/oficina, reentrada e revenda de ativos (modelagem revista após R3);
- OCR de documentos (autopreenchimento);
- Pen test, autenticação Microsoft e 2FA;
- Motor de decisão automático de crédito (fase 2 da política).

---

## Como ler a proposta

1. **A trilha de regras (R1–R7) corre em paralelo** — não consome desenvolvimento e é o que destrava metade da Onda 2. Se uma regra atrasar, o item técnico correspondente desce para a onda seguinte e outro sobe — as ondas são de capacidade, não promessas fixas.
2. **A Onda 1 é quase toda técnica de propósito**: dá tempo de as definições de negócio amadurecerem sem parar a esteira, e entrega a fundação de governança (ambientes, auditoria, parâmetros, alçadas) que a homologação vai exigir.
3. Capacidade considerada: um desenvolvedor + IA, com validação humana por marco, como tem sido.
