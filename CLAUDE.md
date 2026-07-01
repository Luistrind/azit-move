# CLAUDE.md — Azit Move V3

Plataforma de crédito para financiamento de veículos a motoristas de app, com reserva de domínio. Rebuild a partir de documentação (não de código legado). Arquitetura centrada no titular (a pessoa), visão de longo prazo de banco digital. Código e domínio em **português**.

## Antes de codar: leia a documentação

Leia `docs/` nesta ordem antes de escrever qualquer código:

`00-README` → `01-design-thinking` → `02-dominio` → `03-guia-visual` → `04-setup-estrutura` → `05-prisma-schema` → `06-autenticacao` → `07-backlog`

`api-spec.md` complementa, consulte ao implementar endpoints.

## Hierarquia da verdade

`02-dominio.md` é a fonte da verdade do domínio; 03–07 derivam dele. Em conflito, o domínio vence — e a divergência é **sinalizada**, não resolvida em silêncio. Decisão de modelagem nova **sobe** para o doc 02 antes de ir para o código.

## Regras invioláveis

Nunca contrarie sem validação humana explícita:

1. **Asaas executa, Azit controla.** Toda lógica de negócio vive no sistema, não no Asaas.
2. **Recebível nasce no dia zero do contrato ATIVO.** O cronograma completo (parcelas + recebíveis + faturas) é gerado quando o contrato é **ativado pelo pagamento da entrada** — não na formalização. (Decisão 2026-06-29, Luís: na originação nativa, formalização cria o contrato em *Aguardando assinatura* SEM cronograma; assinatura titular+Azit → cobrança da entrada → pagamento → "dia zero" → cronograma. Legado/novação geram o cronograma na criação por já nascerem ativos.)
3. **A dívida independe do ativo.** Sinistro/furto não extingue obrigação. Parcela não é apagada.
4. **Webhook nunca é síncrono.** Responde 202 e enfileira via BullMQ.
5. **Acordo ≠ Novação.** O *Acordo* (recuperação branda) dilui parcelas em atraso sem liquidar o contrato: as parcelas cobertas recebem vínculo de acordo (NÃO o status RENEGOCIADA como marca), e um ItemContratado de origem ACORDO nasce com as parcelas novas. A *Novação* (radical) liquida o contrato inteiro (LIQUIDADO_POR_NOVACAO) e cria um novo. São mecanismos distintos — nunca confundir.
6. **D+3 bloqueio é absoluto.** Sem exceção. Desbloqueio sempre manual.
7. **Status calculados não são gravados.** Em aberto/Vence hoje/Vencida são runtime. Só estados reais vão ao banco.
8. **Titular é o cadastro único.** Cliente e investidor são papéis derivados do que a conta possui — não entidades nem tipos de login.
9. **Sem cor ou status hardcoded.** Cor vem de `statusColors.ts`, status dos enums de `@azit/types`.
10. **Decimal para dinheiro, sempre.** Nunca Float.
11. **Conta ≠ conta corrente.** A Conta é visão unificada de relacionamento, não produto de conta corrente. Nunca sugerir conta corrente (risco regulatório).
12. **Placeholder é funcional, nunca buraco.** Toda regra "a definir" (precificação, alçadas, split) tem padrão provisório que roda e é testável, isolado e marcado como substituível. O sistema simula de ponta a ponta mesmo sem a regra final.
13. **Originação é nativa, em telas.** O dado nasce na tela (Lead → Simulação → Proposta → Análise → Formalização → Ativação), não via API do PopHub (absorvido). Só Asaas e (futuramente) assinatura digital vêm de fora.
14. **Investidor não vê dados pessoais do cliente.** A visão do investidor é financeira e anonimizada (LGPD + proteção do negócio) — a projeção de dados exclui campos pessoais do cliente na origem.

## Como conduzir

Siga a esteira do `07-backlog.md` na ordem (é por dependência técnica). Não pule blocos nem construa item cujas dependências não existem. Núcleo é desenvolvido sobre seed; a originação nativa (telas do funil) é o Bloco 7, construída após o núcleo financeiro validado. Frontend só depois do endpoint que consome. Cada item entregue testado.

## Pare e peça validação humana

- Ao atingir cada **marco** (A–G do backlog) — apresente o construído e como testar; não avance sem confirmação.
- Antes de qualquer decisão de domínio não coberta pelos docs.
- Antes de construir sobre um placeholder (precificação, breakdown de recebível, alçadas, split, assinatura digital) — use o padrão provisório e marque-o; não invente a regra final.

Nesses casos, descreva a ambiguidade e proponha opções — não escolha sozinho.

## O que NÃO fazer

- Não reintroduzir código legado (é clean rebuild).
- Não usar Next.js (frontend é React + Vite, SPA 100% autenticado).
- Não processar webhook de forma síncrona.
- Não criar componente por caso de uso (componentes são genéricos, configurados por props).
- Não avançar marcos sem validação humana.

> Stack, estrutura de pastas, convenções e comandos estão em `04-setup-estrutura.md`. Pré-requisitos: Node 20, pnpm 9, PostgreSQL 16, Redis 7.
