# Requisitos Não Funcionais — Azit Hub

> Consolidação (14/07/2026) dos requisitos não funcionais que já regem o sistema — antes espalhados pelo CLAUDE.md, doc 02 e código — mais os compromissos assumidos e ainda não executados, marcados como **[planejado]**. Item 7 das "Definições Prévias" (Vicente).

## 1. Integridade financeira

- **Dinheiro é sempre Decimal** — nunca Float, em nenhuma camada. Convenção: centavos (inteiro) na API, reais (Decimal) no banco.
- **Histórico financeiro imutável**: parcela nunca é apagada; sinistro/furto não extingue obrigação; renegociação vincula (não sobrescreve) parcelas cobertas.
- **Status calculados não são gravados** — "em aberto", "vence hoje", "vencida" são derivados em tempo de execução; só estados reais vão ao banco.
- **Snapshot congelado**: contratos e simulações gravam a versão de parâmetros usada e nunca são recalculados por mudança de configuração posterior.
- **Migrations sempre aditivas** com backfill — o banco de produção tem dados; nenhuma migration destrutiva.

## 2. Segurança e controle de acesso

- Autenticação JWT; SPA 100% autenticada (nenhuma rota pública além do login).
- Autorização por papel (Admin, Operador, Aprovador, Diretor) com guards por endpoint; operações críticas (parecer, alçadas, bloqueio) restritas por papel.
- Endpoints de desenvolvimento isolados por guard de ambiente (dev-only), inacessíveis em produção.
- Segregação solicitante ≠ decisor no motor de aprovação; princípio de ≥ 2 aprovações em operações sensíveis (configurável por operação).
- **[planejado]** Permissionamento fino por tela/operação; autenticação Microsoft / 2FA; pen test periódico quando a exposição crescer.

## 3. Auditoria e rastreabilidade

- `LogAuditoria` com usuário responsável, antes/depois e timestamp para eventos sensíveis: mudança de parâmetros, alteração/remoção de titular, mudanças na matriz de alçadas, bloqueio/desbloqueio de contrato, quitação antecipada, sinistro, criação/conversão de simulação.
- Trilha completa do motor de aprovação (quem solicitou, quem decidiu, quando, com que justificativa).
- **Regra para funcionalidade futura**: baixa manual de pagamento só existirá com registro obrigatório de responsável **e evidência** (decisão da reunião 13/07 — a baixa hoje é exclusivamente automática via conciliação).

## 4. Privacidade (LGPD)

- Titular único = ponto único de dados pessoais (proteger, retificar, expurgar em um lugar só).
- A visão do investidor exclui dados pessoais do cliente **na origem** (projeção de dados, não filtro de tela).
- Soft delete de titulares (dado não some do banco; sai das leituras).

## 5. Confiabilidade e resiliência

- **Webhook nunca é síncrono**: responde 202 e processa via fila (BullMQ/Redis) com retry.
- Jobs agendados idempotentes (emissão D-5, régua diária).
- Deploy executa `migrate deploy` no start do container — banco e código nunca divergem de versão.
- **[planejado]** Backup diário automatizado + restauração testada; rollback por tag de release (parte do plano de ambientes).

## 6. Disponibilidade e ambientes

- Produção em VPS (Docker Swarm + Traefik, TLS): `app.azitmove.com.br` / `api.azitmove.com.br`.
- **[planejado]** Segregação dev (local) / homologação (`azit-hml`) / produção, com CI (GitHub Actions) — plano aprovado, aguardando execução priorizada.
- Homologação **nunca** recebe cópia da base de produção (LGPD) — dados sintéticos.

## 7. Performance e escalabilidade

- Monolito modular (NestJS + Fastify) — decisão validada em 13/07; extração de serviços só mediante necessidade real de escala.
- Listagens paginadas; consultas com índices nos campos de busca (documento, status, vencimento).
- Cálculo financeiro exclusivamente no backend (`@azit/utils`, funções puras testadas) — o frontend nunca calcula dinheiro.

## 8. Manutenibilidade e processo

- Documentação como fonte da verdade: decisão de domínio sobe ao doc 02 **antes** do código; conflito código × doc é sinalizado, nunca resolvido em silêncio.
- Validação humana obrigatória por marco; entregas testadas (testes unitários nos cálculos financeiros; casos reais de planilha como fixtures).
- Componentes de frontend genéricos configurados por props; cores de status centralizadas (`statusColors.ts`); enums compartilhados (`@azit/types`).
- Decisões arquiteturais registradas em `docs/adr/` (ver índice lá).
