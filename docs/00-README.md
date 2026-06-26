# Documentação Azit Move V3

Esta pasta contém a especificação completa da plataforma. Os documentos foram escritos para serem lidos **em ordem** — cada um assume o entendimento do anterior. Leia todos antes de escrever código.

> Se você é o agente de desenvolvimento: o `CLAUDE.md` na raiz do repositório é o seu manual de operação. Comece por ele, depois volte aqui.

---

## O que é a Azit Move

Plataforma de crédito para financiamento de veículos a motoristas de aplicativo, com reserva de domínio. Arquitetura centrada no titular (a pessoa), com visão de longo prazo de virar um banco digital. O veículo é garantia, não o centro do modelo.

---

## Os documentos, em ordem

| # | Arquivo | O que contém | Por que ler |
|---|---|---|---|
| 00 | `00-README.md` | Este mapa | Orienta a leitura |
| 01 | `01-design-thinking.md` | O raciocínio que levou ao modelo: stakeholders, camadas, modelos de capital, princípios | Entender o **porquê** antes do quê |
| 02 | `02-dominio.md` | Entidades, status, ciclos de vida, regras de negócio, fluxos | **Fonte da verdade do domínio.** Tudo deriva daqui |
| 03 | `03-guia-visual.md` | Sistema de design: tokens, cores por entidade, componentes, telas validadas | Como representar os dados visualmente |
| 04 | `04-setup-estrutura.md` | Stack, estrutura do monorepo, convenções, variáveis de ambiente | Como o projeto é organizado |
| 05 | `05-prisma-schema.md` | O schema completo do banco, decisões de modelagem | A tradução do domínio em tabelas |
| 06 | `06-autenticacao.md` | Identidade (Usuario interno e Titular), roles, RBAC, guards, alçadas | Como o acesso funciona |
| 07 | `07-backlog.md` | A esteira de desenvolvimento, do primeiro ao último item, ordenada por dependência | A ordem em que tudo é construído |

---

## Conceitos centrais (para fixar antes de mergulhar)

Estes cinco conceitos atravessam todos os documentos. Tê-los claros acelera a leitura.

**Titular → Conta → Contratos.** O titular é o cadastro único de pessoa. A conta é seu relacionamento financeiro. Pendurados nela: ContratoCredito (o que o titular deve) e ContratoInvestimento (o que a Azit deve a ele). "Cliente" e "investidor" são papéis derivados do que a conta possui — não entidades.

**A fatura é o agregador; o contrato é a origem.** A dívida nasce no contrato. A fatura é onde ela é cobrada, agregando itens de múltiplos contratos do titular numa cobrança semanal — como uma fatura de cartão.

**O recebível nasce no dia zero.** O cronograma completo é gerado na criação do contrato. O sistema sabe desde o início o que espera receber em cada data.

**Asaas executa, Azit controla.** O Asaas é meio de pagamento. Toda a lógica vive no sistema.

**Renegociação é novação.** Parcelas antigas são extintas; um novo crédito (ItemContratado de origem RENEGOCIACAO) nasce para substituí-las — exatamente como num banco.

---

## Como a documentação foi construída

Cada decisão de modelagem deste projeto foi tomada aplicando uma régua: **"como funciona em um banco?"**. Foi assim que chegamos ao titular único, à conta unificada e ao contrato de investimento como espelho do crédito. Se você encontrar uma decisão nova a tomar durante a implementação, aplique a mesma régua — e suba a decisão para o doc 02 antes de propagá-la.

---

## Placeholders conhecidos

Estes pontos estão deliberadamente em aberto, aguardando definição externa. Não construa sobre eles sem sinalizar:

| Placeholder | Aguarda | Onde aparece |
|---|---|---|
| Fórmula de breakdown do recebível (amortização + rendimento + taxa) | Estrutura jurídica do fundo (Sebastião) | docs 02, 03, 05 |
| Regras de alçada (limites, níveis) | Vicente | docs 02, 06 |
| Payload exato da integração PopHub | Equipe PopHub | doc da API, 07 |
| Estrutura do fundo e split | Sebastião | doc da API, 07 |

---

## Documento complementar

`api-spec.md` (na raiz de `/docs`) detalha os contratos da API REST: originação, listagens, webhooks, integração com Asaas. Consulte-o ao implementar endpoints.
