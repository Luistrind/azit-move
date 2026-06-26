# Doc 7 — Backlog Priorizado
## Azit Move V3

**Versão:** 1.0  
**Data:** jun/2025  
**Status:** Aprovado — esteira completa de desenvolvimento

---

## Como ler este documento

Este é o backlog completo da V3, do primeiro ao último item. **Não é "fase 1 vs fase 2"** — é uma esteira única, ordenada por **dependência técnica**: cada item só aparece depois que tudo de que ele precisa já foi construído. Seguir a ordem garante que nada seja desenvolvido dependendo de algo que ainda não existe.

**Princípio de ordenação:** dependência de baixo para cima. Fundação → dados base → núcleo do negócio → ciclo de cobrança → régua → operações sobre contratos → originação real → camadas externas.

**Estratégia de dados:** o núcleo é desenvolvido e validado sobre **dados semeados** (seed). A originação via API do PopHub entra depois que o ciclo de cobrança estiver validado, desacoplando o desenvolvimento do núcleo de uma dependência externa.

Cada item lista o que entrega e de que depende. A coluna "Depende de" referencia os números dos itens anteriores.

---

## Bloco 0 — Fundação

Nada funciona sem isto. É a base de toda a esteira.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 0.1 | Monorepo e workspace | Estrutura pnpm, tsconfig base, scripts globais (Doc 4) | — |
| 0.2 | Pacote @azit/types | Enums e interfaces compartilhadas | 0.1 |
| 0.3 | Pacote @azit/utils | Formatters, `calcularValorPresente`, `resolverStatusParcela` | 0.1 |
| 0.4 | Backend base (NestJS + Fastify) | App sobe, health check, config de ambiente | 0.1 |
| 0.5 | Banco e Prisma | PostgreSQL local, schema do Doc 5, primeira migration, PrismaService | 0.4 |
| 0.6 | Extensão de soft delete | Filtro global `deletedAt: null` via Prisma extension | 0.5 |
| 0.7 | Redis e BullMQ base | Conexão, registro das 6 filas (sem processadores ainda) | 0.4 |
| 0.8 | Frontend base (React + Vite) | App sobe, Tailwind com tokens do Doc 3, React Router, TanStack Query, axios com interceptors | 0.1 |
| 0.9 | Shell da UI | Sidebar, Topbar, área de scroll, `statusColors.ts` | 0.8 |

---

## Bloco 1 — Autenticação interna

O acesso ao console. Tudo que vem depois é protegido por isto.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 1.1 | Modelos de auth | Usuario, UsuarioRole, RefreshToken no banco; seed de um usuário admin | 0.5 |
| 1.2 | Login | `POST /auth/login`, hash bcrypt, geração de access + refresh token | 1.1 |
| 1.3 | JwtAuthGuard | Validação de token global, `request.user` populado | 1.2 |
| 1.4 | Refresh e logout | `POST /auth/refresh` (com rotação), `POST /auth/logout` (revogação) | 1.2 |
| 1.5 | RolesGuard | Decorator `@Roles()`, autorização por interseção de roles | 1.3 |
| 1.6 | Tela de login | LoginPage no frontend, fluxo de token, redirect | 0.9, 1.2 |
| 1.7 | Sessão no frontend | authStore (Zustand), interceptor de refresh, guarda de rotas | 1.6 |

---

## Bloco 2 — Dados base

As entidades que tudo referencia. Sem titular, conta e ativo, não há contrato.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 2.1 | Titular | CRUD de Titular, busca por CPF/CNPJ, validação de documento | 1.5 |
| 2.2 | Conta | Conta criada/vinculada ao titular, status | 2.1 |
| 2.3 | Ativo | CRUD de Ativo (veículo), busca por chassi/placa | 1.5 |
| 2.4 | OrigemCapital | Registro da origem de capital do ativo (próprio, empréstimo, investidor, fundo) | 2.3 |
| 2.5 | Seed de dados base | Script que popula titulares, contas e ativos fictícios para desenvolvimento | 2.1, 2.2, 2.3 |

---

## Bloco 3 — Núcleo do negócio: ContratoCredito e cronograma

O coração do sistema. A geração do cronograma é o item mais crítico de toda a esteira.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 3.1 | ContratoCredito | Criação de contrato vinculando conta + ativo, com itens da cesta | 2.2, 2.4 |
| 3.2 | ItemContratado | Itens da cesta (financiamento, proteção, taxa) com natureza e credor | 3.1 |
| 3.3 | Geração de cronograma | Geração de todas as Parcelas no dia zero, com `createMany` em transação | 3.2 |
| 3.4 | Recebíveis | Criação de Recebível para cada parcela (estado esperado) | 3.3 |
| 3.5 | Cálculo de status de parcela | `resolverStatusParcela` em runtime (em aberto/vence hoje/vencida) | 3.3 |
| 3.6 | Seed de contratos | Script que popula contratos completos com cronograma para desenvolver cobrança | 3.3, 3.4 |
| 3.7 | Listagem de carteira | Tela de Carteira Operacional (KPIs, tabela de contratos) sobre dados semeados | 3.1, 1.7 |
| 3.8 | Detalhe do contrato | Tela de detalhe (header, tab cronograma) | 3.7 |

---

## Bloco 4 — Ciclo de cobrança

Faturas, Asaas e conciliação. Depende do cronograma existir.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 4.1 | Fatura e ItemFatura | Geração das faturas futuras no dia zero, agregando itens por ciclo | 3.3 |
| 4.2 | Fechamento de fatura (D-5) | Job agendado que fecha a fatura e congela seus itens | 4.1, 0.7 |
| 4.3 | Cliente Asaas | Serviço de integração: criar cobrança avulsa, buscar customer por CPF | 0.4 |
| 4.4 | Geração de cobrança | Fila `gerar-cobranca-asaas`: ao fechar fatura, cria cobrança no Asaas | 4.2, 4.3 |
| 4.5 | Recepção de webhook | `POST /webhooks/asaas` com validação de assinatura, responde 202 e enfileira | 0.7, 4.3 |
| 4.6 | Conciliação de pagamento | Fila `pagamento-recebido`: baixa fatura e parcelas, atualiza recebível | 4.5, 3.4 |
| 4.7 | Cálculo de encargos | Breakdown de multa/juros em pagamento com atraso, independente do Asaas | 4.6 |
| 4.8 | Notificação WhatsApp | Fila `notificar-cliente`: envia link de pagamento via Z-API no vencimento | 4.2, 0.7 |
| 4.9 | Tab extrato | Tela de extrato do contrato com eventos de pagamento conciliados | 4.6, 3.8 |

---

## Bloco 5 — Régua de cobrança

Depende de faturas vencendo sem pagamento.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 5.1 | Marcação de inadimplência | Fila `pagamento-vencido`: fatura vencida → contrato inadimplente | 4.5 |
| 5.2 | Estágios da régua | Lógica D+1 → D+2 → D+3 → D+10 → D+12, configurável | 5.1 |
| 5.3 | Job da régua | Fila `regua-step`: avança contratos pelos estágios conforme dias de atraso | 5.2, 0.7 |
| 5.4 | Bloqueio (D+3) | Registro do bloqueio do veículo (regra absoluta), integração de bloqueio | 5.3 |
| 5.5 | Desbloqueio manual | Ação humana de desbloqueio após confirmação de regularização | 5.4 |
| 5.6 | Painel da régua (kanban) | Tela de Régua com kanban de 5 colunas, tempo real via webhook | 5.3, 1.7 |

---

## Bloco 6 — Operações sobre contratos

Renegociação, quitação, sinistro, reajuste. Dependem do contrato e do ciclo de cobrança maduros.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 6.1 | Estrutura de alçadas | Modelo Alcada configurável, verificação de limite no banco | 1.5 |
| 6.2 | Renegociação — seleção | Módulo: seleção de obrigações em aberto por item ou fatura, soma do saldo | 4.6, 6.1 |
| 6.3 | Renegociação — acordo | Acordo em rascunho, geração de cobrança da entrada no Asaas | 6.2, 4.3 |
| 6.4 | Renegociação — efetivação | Webhook da entrada → novação: parcelas antigas renegociadas, ItemContratado de origem RENEGOCIACAO gerado, novas parcelas criadas | 6.3, 4.5 |
| 6.5 | Tela de acordos | Lista de acordos, modal de renegociação em 3 etapas | 6.4, 1.7 |
| 6.6 | Quitação antecipada | Três variantes (parcelas específicas, total, encerramento) usando VP | 4.6, 0.3 |
| 6.7 | Sinistro | Registro de sinistro, amortização por indenização, saldo remanescente | 4.6 |
| 6.8 | Reajuste IPCA | Reajuste anual com aprovação humana via alçada | 6.1, 3.3 |

---

## Bloco 7 — Originação real (PopHub)

Agora que o núcleo está validado sobre seed, conecta a entrada de dados reais.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 7.1 | Contrato de integração PopHub | Definição do payload exato com a equipe do PopHub | 3.3 |
| 7.2 | Endpoint de originação | `POST` que recebe contrato + titular + ativo, identifica/cria, gera cronograma | 7.1, 3.3, 2.5 |
| 7.3 | Conciliação de entrada | Registro e conciliação da entrada já paga no Asaas | 7.2, 4.3 |
| 7.4 | Migração do legado | Importação dos 76 contratos legados via a mesma API de originação | 7.2 |

---

## Bloco 8 — Camadas externas

Investidor e portal do titular. Dependem de todo o núcleo financeiro funcionando.

| # | Item | Entrega | Depende de |
|---|---|---|---|
| 8.1 | ContratoInvestimento | Modelo e CRUD do contrato de investimento na conta do titular | 2.2 |
| 8.2 | Breakdown de recebível | Cálculo amortização + rendimento + taxa (depende da fórmula do fundo) | 4.6, 8.1 |
| 8.3 | Split de pagamento | Configuração de split no Asaas por origem de capital | 8.2, 4.4 |
| 8.4 | Visão investidor de ativo | Tela de performance do contrato de investimento (ativo específico) | 8.2, 1.7 |
| 8.5 | Visão investidor de fundo | Tela consolidada do fundo | 8.2, 1.7 |
| 8.6 | Autenticação do titular | Fluxo de login do titular (CPF + fator), resolução de módulos | 2.2 |
| 8.7 | Portal do titular | Telas do módulo cliente e investidor que o titular acessa | 8.6, 4.9 |
| 8.8 | Produto capital protegido | Reembolso de principal não recuperado ao investidor (produto futuro) | 8.2 |

---

## Dependências externas que destravam itens

Alguns itens dependem de decisões ou entregas de fora do desenvolvimento. Registrados para acompanhamento:

| Item bloqueado | Depende de | Responsável |
|---|---|---|
| 6.1 Alçadas (regras) | Definição de limites e níveis | Vicente |
| 6.7 Sinistro (detalhes) | Fluxo já decidido em 23/06 — apenas implementar | — |
| 7.1 Integração PopHub | Payload exato do lado PopHub | Equipe PopHub |
| 8.2 Breakdown de recebível | Estrutura jurídica do fundo | Sebastião |
| 8.3 Split / 8.5 Fundo | Estrutura jurídica do fundo | Sebastião |
| 8.8 Capital protegido | Definição do produto | Vicente |

---

## Marcos de validação

Pontos naturais onde o sistema tem valor demonstrável de ponta a ponta:

**Marco A — Console autenticado (fim do Bloco 1):** time interno faz login e navega no shell vazio.

**Marco B — Carteira visível (fim do Bloco 3):** contratos semeados aparecem na carteira com cronograma completo. O coração do modelo está validado.

**Marco C — Ciclo de cobrança fechado (fim do Bloco 4):** uma fatura semeada fecha, gera cobrança no Asaas, e um pagamento de teste é conciliado via webhook. O fluxo financeiro funciona ponta a ponta.

**Marco D — Régua operante (fim do Bloco 5):** uma fatura vencida percorre a régua e dispara bloqueio. A gestão de inadimplência funciona.

**Marco E — Operações completas (fim do Bloco 6):** renegociação, quitação e sinistro funcionam sobre dados semeados. O sistema cobre o ciclo de vida completo de um contrato.

**Marco F — Dados reais (fim do Bloco 7):** contratos reais entram via PopHub e o legado é migrado. O sistema opera de verdade.

**Marco G — Plataforma de crédito (fim do Bloco 8):** investidores e titulares acessam suas visões. A visão de banco se materializa.

---

## Observações de execução

- **Frontend acompanha o backend, não o precede.** Cada tela só é construída depois que seu endpoint existe. As telas estão posicionadas logo após os dados que consomem.
- **Seed é infraestrutura, não descarte.** Os scripts de seed (2.5, 3.6) permanecem úteis para testes e ambientes de desenvolvimento mesmo depois que a originação real existir.
- **BullMQ desde o Bloco 0.** As filas são registradas cedo (0.7), mas os processadores entram conforme cada fluxo é construído. Nunca processar webhook de forma síncrona.
- **Cada item deve ser entregue testado.** A estratégia de testes (não detalhada aqui) acompanha cada item, não é um bloco separado no fim.

---

*Doc 7 — Backlog Priorizado · Azit Move V3 · v1.0 · jun/2025*
*Documentos relacionados: Doc 2 — Domínio · Doc 3 — Visual · Doc 4 — Setup · Doc 5 — Schema · Doc 6 — Autenticação*
