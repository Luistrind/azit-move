# Proposta de UX — Arquitetura de Telas do Azit Hub

> Agosto/2026. Reorganização da **experiência do usuário** antes da entrada do Catálogo de Produtos: divisão de telas, onde vive cada fluxo, navegação, mobile e base para permissionamento. **Não trata de identidade visual** (cores/tipografia ficam como estão).

## 1. Diagnóstico honesto — por que o sistema ficou contraintuitivo

O sistema foi construído função-primeiro (a esteira técnica manda), e cada entrega virou um item de menu ou um botão dentro de uma página existente. As consequências que a validação em tela expôs:

1. **Menu plano e sem hierarquia** — itens na ordem em que foram construídos, não na ordem do trabalho de quem usa.
2. **Fluxos escondidos** — ações importantes moram dentro de páginas de detalhe (a análise dentro da proposta; a renegociação dentro da ficha; sem listagem de análises no menu).
3. **Telas-dossiê** — páginas que mostram tudo de uma vez sem dizer **o que fazer agora** (análise de cadastro é o exemplo).
4. **Falta de fila de trabalho** — nenhum papel loga e vê "o que está esperando por mim".
5. **Padrões inconsistentes** — máscaras presentes em uns campos e ausentes em outros; `prompt()` do navegador em decisões sérias; status em CAIXA_ALTA; siglas em tela.
6. **Mobile como adaptação, não desenho** — o responsivo evita quebra, mas a simulação na frente do cliente (iPhone) exige uma tela **desenhada para o balcão**, não uma tela de escritório espremida.

## 2. Princípios (valem para tudo que já existe e para o que vem)

| # | Princípio | Significado prático |
|---|---|---|
| P1 | **Uma tela = um trabalho** | Cada tela responde a uma tarefa de uma pessoa; dossiês viram etapas guiadas |
| P2 | **Próximo passo sempre visível** | Toda tela de fluxo diz o que falta e traz o botão da ação principal em destaque |
| P3 | **Fila antes de ficha** | Quem trabalha entra pela SUA fila (pendências do papel), e da fila abre o caso |
| P4 | **Nomes por extenso** | Nenhuma sigla em tela (CRF → "Comissão recorrente por período"); status legíveis ("Aguardando análise do COCAD") |
| P5 | **Entrada de dados uniforme** | Máscara brasileira em TODO campo: dinheiro, CPF/CNPJ, telefone, CEP, placa, km, percentuais; componente único de input reaproveitado |
| P6 | **Modal, nunca prompt()** | Decisões (não aprovação, ressalvas, encerramentos) em modais próprios com contexto |
| P7 | **Mobile por classe de tela** | Telas **de campo** (usadas na frente do cliente) são desenhadas mobile-primeiro; telas **de escritório** são responsivas; telas **administrativas** podem ser desktop |
| P8 | **Área de menu = fronteira de permissão** | O agrupamento do menu é o mesmo do permissionamento — dar/tirar acesso por área nunca quebra um fluxo no meio |

## 3. Arquitetura de informação — o menu por áreas de trabalho

Alinhada aos 10 domínios oficiais (a taxonomia do Vicente vira a navegação) e às personas. Cada área é um escopo de permissão natural:

| Área (menu) | O que contém | Quem usa (perfil típico) |
|---|---|---|
| **Início** | Fila de trabalho do papel logado: pendências, análises aguardando, aprovações, ressalvas vencendo, faturas em atraso | Todos (conteúdo muda por papel) |
| **Comercial** | Novo atendimento (modo balcão), Simulações, Propostas (Kanban) | Atendente/Operador |
| **Análise de Cadastro** | Fila de análises (status, tempo em cada estado), workspace da análise, fila do COCAD | Analista, COCAD |
| **Contratos** | Contratos, formalizações em andamento, assinaturas/ativações pendentes | Operador |
| **Carteira & Cobrança** | Carteira por titular, faturas, régua (Kanban), renegociações, quitações/antecipações | Cobrança/Financeiro |
| **Pessoas** | Cadastro único com abas: Clientes · Investidores · Fornecedores · Parceiros; ficha-hub do titular | Operador (leitura ampla) |
| **Ativos & Frota** | Veículos, documentos do veículo, centro de custo, vínculo com estrutura de capital | Operação |
| **Capital & Investimento** | Estruturas jurídicas (fundos/rodadas), investidores, aportes, ativos por estrutura | Diretoria |
| **Produtos** *(novo)* | Catálogo: Produtos → Variantes → Versões, parâmetros por extenso, ciclo de vida (rascunho/ativo/suspenso/encerrado), histórico | Diretoria |
| **Aprovações** | Central de aprovações (COCAD, crédito, novação, reajuste) com badge | Aprovador, Diretor |
| **Configurações** | Central de parâmetros **por fluxo/produto**, alçadas, usuários e permissões, auditoria consultável | Admin |

Regras da navegação: máximo 2 níveis (área → tela); breadcrumb em toda tela de detalhe; botão voltar consistente; busca global por CPF/placa/nome no topo.

## 4. Os quatro fluxos que mudam de experiência

### 4.1 Modo balcão — atendimento + simulação (mobile-primeiro) 📱
A tela usada **na frente do cliente** vira um fluxo de passos em tela cheia, desenhado para iPhone:
1. Cliente (nome, CPF, telefone, canal) — campos grandes, máscara automática, CEP busca sozinho.
2. Produto e veículo — escolha do produto (Compra Parcelada → variante Carro/Moto/Outro), veículo da vitrine com foto.
3. Condições — as 3 condições padrão da variante como **cards grandes com o valor da parcela em destaque** ("R$ 640,50 por semana") + personalizada com 3 controles (entrada, prazo, frequência).
4. **Modo apresentação** — um toque esconde os controles internos e mostra só o que o cliente deve ver (parcela, entrada, "inclui proteção veicular"), com fonte grande. Botões: Apresentar · Selecionar · Converter em proposta.
Nada de tabela nessa jornada; tabelas só nas telas de escritório.

### 4.2 Análise de cadastro guiada (pacote já desenhado na validação)
Stepper com as 5 macroetapas (Cadastro → Autorização & Documentos → Consultas → Parecer & Decisão → Liberação), barra "próximo passo" com a ação principal, etapas concluídas colapsadas, consultas legíveis, códigos traduzidos, modais no lugar de prompts. Entra no menu com **fila própria**.

### 4.3 Fila de trabalho ("Início")
Cada papel loga e vê seus pendentes com um clique de distância: analista (análises por status/tempo), aprovador (COCAD + aprovações), cobrança (vencidas, régua do dia, ressalvas expirando), atendente (leads a retomar, simulações a vencer). É a tela que faz o sistema "se explicar" — e o embrião dos SLAs (RF-25).

### 4.4 Produtos (as telas novas já nascem no padrão)
- **Lista**: cards por produto com status de ciclo de vida e versão vigente.
- **Detalhe do produto**: abas Variantes · Parâmetros (por extenso, com herança visível: "herdado do produto" / "específico da variante") · Regras · Cálculos · Versões (histórico) · Condições padrão.
- **Editar = rascunho**: mudança material abre um rascunho de nova versão com **diff visual** (antes → depois) e botão Ativar; nada de editar valor vigente "no lugar".
- Simulador passa a consumir daqui — na simulação, o operador vê "Produto · Variante · Versão" no rodapé da condição (rastreabilidade visível).

## 5. Padrões transversais (checklist de conformidade de toda tela)

1. Máscaras BR universais via componente único: R$ (milhar/vírgula), CPF/CNPJ, telefone, CEP, placa Mercosul, km, % com vírgula.
2. Nomes por extenso; tooltips explicativos onde o termo é técnico.
3. Status com chip de cor (statusColors) e texto legível — nunca ENUM_CRU.
4. Modais para decisões; confirmação com resumo do efeito ("Isso vai...").
5. Estados vazios com orientação ("Nenhuma análise em andamento — inicie pela proposta").
6. Erros da API traduzidos em mensagem de ação ("Registre a autorização do participante antes de consultar").
7. Datas/hora no formato brasileiro; valores sempre com R$.
8. Toque mínimo de 44px em elementos interativos (mobile).

## 6. Permissionamento sem dor futura

- **Nível 1 (agora)**: acesso por **área de menu** × papel — matriz simples, resolve o dia a dia dos funcionários e é o que o MVP exige como "permissões mínimas seguras".
- **Nível 2 (já suportado pelo backend)**: ações sensíveis dentro da área continuam protegidas por papel/alçada (aprovar, liberar, não aprovar, editar produto).
- **Nível 3 (futuro, sem retrabalho)**: permissão fina por ação — como as áreas já são fronteiras, granular depois não muda a navegação.
- Diretoria gere Produtos **sem workflow de aprovação** (permissão + auditoria), conforme o Modelo de Gestão.

## 7. Plano de execução proposto (pacotes, em ordem)

| Pacote | Conteúdo | Quando |
|---|---|---|
| **UX-1 Navegação** | Menu por áreas + tela Início (fila por papel) + breadcrumbs/voltar + busca global | Antes do Catálogo — é a fundação |
| **UX-2 Modo balcão** | Atendimento + simulação mobile-primeiro com modo apresentação | Junto com UX-1 (é a dor relatada no iPhone) |
| **UX-3 Análise guiada** | Stepper + próximo passo + modais + fila de análises | Primeiro item do lote pós-teste (já desenhado) |
| **UX-4 Padrões transversais** | Componente de input com máscaras universais, modais, estados vazios, tradução de status | Contínuo — começa em UX-1 e vira critério de aceite de toda tela nova |
| **UX-5 Telas de Produtos** | Catálogo já nasce no padrão novo | Junto com a implementação do Catálogo |

Sequência com o Catálogo de Produtos: **UX-1 + UX-2 primeiro** (1 pacote de trabalho), depois Catálogo backend + UX-5, com UX-3/UX-4 intercalados. Assim nenhuma tela nova nasce no padrão velho.

## 8. O que este documento NÃO muda

Cores, tipografia e identidade visual; regras de negócio; nada de backend — é reorganização de navegação, telas e padrões de interação. Nenhuma rota antiga quebra: as URLs atuais continuam funcionando durante a transição.
