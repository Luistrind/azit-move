# Domínios e Módulos Macro do Azit Move V3

> Mesmo formato do documento "Domínios e Módulos Macro do Azit Hub" (Vicente), porém descrevendo **o sistema real em produção** — cada módulo listado existe e opera hoje, salvo quando marcado como *(placeholder funcional)* ou *(parcial)*. O que ainda não existe está separado no final, em "Registrado para evolução".

## Lista de Domínios

1. Plataforma, Governança e Parâmetros
2. Titular, Conta e Relacionamento
3. Originação Comercial (funil nativo)
4. Análise e Decisão
5. Ativos e Frota
6. Contratos e Ativação
7. Carteira, Cobrança e Recuperação
8. Produtos e Serviços
9. Capital e Investimento
10. Dados e Indicadores

---

## 1. Plataforma, Governança e Parâmetros

Domínio transversal que sustenta os demais. Princípio central: toda regra de negócio vive no sistema; parceiros externos apenas executam.

Módulos:

- Gestão de usuários e papéis (Admin, Operador, Aprovador, Diretor);
- Autenticação e segurança de acesso (JWT, SPA 100% autenticada, guards por papel);
- Alçadas configuráveis — matriz papel × operação editável pelo administrador;
- Motor de aprovação unificado — trilha de decisões, N aprovações por operação, segregação solicitante ≠ decisor, recomendar/escalar, usado por crédito, renegociação, novação e reajuste;
- Parâmetros internos versionados — nova configuração gera nova versão; contratos e simulações congelam a versão usada (nunca são recalculados retroativamente);
- Log de auditoria *(parcial — cobre parâmetros e aprovações; cobertura em expansão)*;
- Processamento assíncrono (filas BullMQ — webhooks nunca são síncronos);
- Ferramentas de desenvolvimento/health isoladas por ambiente.

---

## 2. Titular, Conta e Relacionamento

Domínio da pessoa. O **Titular é o cadastro único**: cliente e investidor são papéis derivados do que a conta possui — não entidades nem tipos de login separados.

Módulos:

- Cadastro de titulares (PF/PJ, dados cadastrais, endereço com busca por CEP);
- Conta — visão unificada do relacionamento (não é conta corrente): agrega contratos, faturas e posição consolidada;
- Ficha-hub do titular — carteira, contratos, faturas e ações (crédito, renegociação) partem da ficha;
- Papéis derivados (cliente/investidor calculados, nunca gravados como tipo);
- Proteção de dados por desenho — a visão de investidor exclui dados pessoais do cliente na origem (LGPD).

---

## 3. Originação Comercial (funil nativo)

Domínio do início da jornada. O dado nasce **na tela** (Lead → Simulação → Proposta), não via API externa.

Módulos:

- Atendimento e gestão de leads (nome, CPF, telefone, canal de origem: OLX, WhatsApp, Instagram, indicação);
- Simulação V3 com motor real de precificação (parâmetros versionados, prazo em meses, frequência semanal/quinzenal/mensal);
- Ofertas fixas desenhadas (valores redondos, ativos vinculados) + ofertas padrão + simulação personalizada;
- Ciclo de vida da simulação — validade de 7 dias, estados (apresentada, selecionada, expirada, convertida), retomada pela listagem, imutável após conversão;
- Proposta formal — Kanban por status, carrinho de produtos, vínculos de papéis (comprador, garantidor);
- Intake documental — documentos obrigatórios por papel, pendências calculadas, gate para análise.

---

## 4. Análise e Decisão

Domínio da decisão de crédito. Hoje a decisão é **humana e estruturada**; motor automático e bureaus entram quando a política de crédito for formalizada.

Módulos:

- Análise documental (checklist de obrigatórios, bloqueio de avanço com pendência);
- Análise rica — anexos de embasamento, observação analítica;
- Parecer em cards — aprovado / aprovado com ressalva (motivos) / reprovado (motivo), exigência de garantidor;
- Papel específico de Aprovador com segregação;
- Análise de capacidade de pagamento *(placeholder funcional — regra provisória isolada e marcada como substituível)*.

---

## 5. Ativos e Frota

Domínio dos veículos e demais ativos. Regra estrutural: **a dívida independe do ativo** — sinistro ou furto não extingue a obrigação.

Módulos:

- Cadastro de ativos (veículos e ativo sintético para crédito avulso);
- Disponibilidade e estoque (status do ativo, vínculo a contrato);
- Documentação veicular — arquivos por veículo, download, central de documentos no cadastro;
- Centro de custo por ativo — gasto × recebido por veículo, visão separada para crédito avulso, estrutura desenhada para expandir;
- Vínculo do ativo a oferta fixa (vitrine comercial);
- Bloqueio/desbloqueio como processo registrado (D+3 absoluto; desbloqueio sempre manual).

---

## 6. Contratos e Ativação

Domínio que transforma proposta aprovada em operação ativa. Regra central: **o cronograma nasce no "dia zero" — o pagamento da entrada** — não na formalização.

Módulos:

- Motor de templates com dados × layout separados; contrato oficial de compra e venda (17 cláusulas) como padrão;
- Formalização com etapa de parametrização (data da 1ª parcela definida pelo operador; padrão segunda-feira para motoristas de app);
- Pacote de contratos por proposta — contrato do veículo + contratos apartados (ex.: seguro), com âncora;
- Assinatura interna titular + Azit *(plataforma de assinatura digital externa em backlog)*;
- Ativação pelo pagamento da entrada — cobrança gerada, webhook confirma, cronograma completo nasce (parcelas + recebíveis + faturas);
- Entrada à vista ou parcelada (intermediárias);
- Aditivos por mecanismos formais distintos: Acordo (dilui atraso sem liquidar) e Novação (liquida e recria) — nunca confundidos.

---

## 7. Carteira, Cobrança e Recuperação

Domínio central do ciclo financeiro. Duas regras estruturais: a cobrança é **da Conta** (a fatura agrega parcelas de todos os contratos do titular) e o **Asaas executa, o Azit controla** (toda lógica no sistema; o parceiro só cobra).

Módulos:

- Parcelas com status reais no banco (status calculados — "em aberto", "vence hoje", "vencida" — são derivados em tempo de execução, nunca gravados);
- Recebíveis nascidos no dia zero, um a um por parcela;
- Faturas consolidadas da conta — parcela nova entra na próxima fatura aberta (crédito novo e renegociação consolidam na mesma cobrança);
- Integração Asaas — emissão de cobrança, multa e juros configurados, webhook assíncrono (202 + fila), baixa e conciliação automáticas;
- Imputação de pagamento na ordem encargo → serviço → principal;
- Régua de cobrança — emissão D-5, fechamento, cobrança D+1/D+2, bloqueio D+3 (manual e registrado);
- Renegociação (Acordo) conta-cêntrica — diagnóstico do atraso de todos os contratos, entrada como aceite formal via webhook, explosão proporcional por contrato preservando credores;
- Novação — liquidação integral do contrato e criação de um novo;
- Quitação e antecipação de parcelas — cada parcela decomposta em serviço (CR) e capital+remuneração (PS), descontados a taxas próprias (fórmula homologada com o financeiro);
- Crédito de manutenção para cliente ativo — valor livre, aprovado por alçada, cobrado na fatura existente;
- Reajuste anual por IPCA (evento → revisão → aprovação);
- Sinistro/perda do ativo sem extinção da dívida.

---

## 8. Produtos e Serviços

Domínio do catálogo comercializável junto ao veículo.

Módulos:

- Catálogo de produtos (seguro e demais serviços);
- Itens contratados por contrato, com natureza, credor e periodicidade;
- Contratos apartados para produtos que exigem instrumento próprio;
- Precificação de crédito avulso com taxa equivalente à periodicidade.

---

## 9. Capital e Investimento

Domínio da fonte do dinheiro. Decisão registrada: **todo capital é tratado como de investidor** (a própria Azit/PopCarros é um investidor). Estrutura básica existente; evolução aguarda o desenho do breakdown do recebível.

Módulos:

- Origem de capital por ativo (estrutura registrada);
- Posições de investimento (estrutura básica);
- Breakdown do recebível — capital × remuneração × serviço *(placeholder funcional; desenho em andamento com o financeiro)*;
- Visão anonimizada por desenho (investidor nunca vê dados pessoais do cliente).

---

## 10. Dados e Indicadores

Domínio de leitura gerencial. Hoje é operacional, embutido nas telas; BI dedicado vem depois do dado financeiro granular (breakdown).

Módulos:

- KPIs da carteira (posição, inadimplência, status);
- Centro de custo por ativo (margem por veículo);
- Trilhas de aprovação e histórico por titular;
- Log de auditoria consultável.

---

## Registrado para evolução (não construído — em backlog com desenho ou decisão pendente)

- Assinatura digital externa com aceite item a item (log de IP/dispositivo por cláusula);
- Consultas externas / bureaus e motor de decisão de crédito (depende da política formalizada);
- Breakdown do recebível e visão/portal do investidor;
- Portal do titular (cliente);
- Permissionamento fino por tela/operação;
- Financeiro administrativo (contas a pagar, fornecedores, lotes) — deliberadamente fora do V1, foco no ciclo de receita;
- Multi-empresa / unidades de negócio;
- BI executivo e relatórios para investidores;
- Integração com rastreador/bloqueador veicular;
- OCR de documentos (autopreenchimento de cadastro);
- Segregação formal de ambientes dev/homolog/prod (plano pronto, aguardando execução);
- CRM comercial completo (cadência, tarefas, follow-up).
