# Requisitos — Contas a Pagar (Financeiro Administrativo / ERP Enxuto) v0.1 — Azit Hub

**Data:** 03/08/2026 · **Status:** v0.1 — decisões do Luís (03/08) incorporadas; desenvolvimento autorizado direto, validação no sistema construído · **Base normativa:** AZH-FIN-PROC-001 (Processo de Contas a Pagar V1.0) e AZH-FIN-CTX-001 (Contexto e Racional) — os códigos RCPG-xxx e RF-xx citados referem-se a esses documentos.

---

## 0. Decisões incorporadas (Luís, 03/08)

| # | Tema | Decisão |
|---|---|---|
| 1 | Alçadas | Seed com os **valores anteriores** (até R$ 100 / R$ 100,01–1.000 / acima de R$ 1.000). O essencial: **alçada parametrizável POR TIPO de aprovação**, com **valores mínimo e máximo configuráveis por célula** — o Reembolso Parcelado pode ter faixas diferentes de uma renegociação ou de uma despesa administrativa. (Evolução da matriz de alçadas existente: acrescenta limite mínimo.) |
| 2 | Papel "Gestor do centro de custo" | ⚠️ **EM ABERTO — pensar melhor** (a parametrização por tipo muda a visão). Placeholder marcado: a faixa intermediária fica com o papel Aprovador na matriz; o cadastro de centro de custo já nasce com campo "responsável" para ligar depois, sem retrabalho. |
| 3 | Entidade legal × Estrutura Jurídica | **Cadastro próprio de Entidade Legal**, com vínculo opcional à Estrutura Jurídica do domínio Capital. |
| 4 | Centro de custo | Cadastro **organizacional** novo (CC01–CC07 do Processo §4.2); a tela atual "Centros de custo" é na verdade **custo por ativo** (dimensão ativo/placa) e será renomeada. Veículo/investidor/produto **nunca** viram centro de custo (anti-padrão do Contexto, Anexo B). |
| 5 | Desembolso do Reembolso Parcelado | A **efetivação do RP gera automaticamente o título de desembolso de produto** no contas a pagar, com vínculos obrigatórios (operação, cliente, veículo, recebível) — RCPG006/029, RF-22. |

Pendências que NÃO bloqueiam (placeholders funcionais, Regra 12): naturezas do Anexo C a homologar com o BPO (seed inicial editável); layout/e-mail do arquivo BPO (resumo CSV padronizado provisório); limite de pequeno valor p/ dispensa de cotação, tolerância orçamento×documento e prazo de prestação de contas (parâmetros com default 5 dias úteis); quem é o "outro diretor" (coberto pela segregação: aprovador ≠ solicitante).

---

## 1. Escopo e faseamento (espelha o Processo §12.1)

| Fase | Entrega | Situação |
|---|---|---|
| **1 — Fundação** | Entidades legais, contas bancárias, naturezas financeiras, centros de custo organizacionais, fornecedores com dados bancários versionados e aprovação em 2 etapas | Neste bloco |
| **2 — Fluxo operacional** | Orçamento (cotação simplificada), título a pagar, validação com checklist, alçadas por tipo, duplicidade, bloqueio de campos críticos, lote por entidade+conta, corte 12h, resumo ao BPO | Neste bloco |
| **3 — Execução e conciliação** | Eventos manuais BPO/Cora, autorização, pagamento com comprovante, baixa, conciliação manual, divergências | Neste bloco |
| **4 — Produtos e multi-entidade** | Desembolso automático do Reembolso Parcelado vinculado ao recebível; responsável econômico; intercompany documentado (mínimo) | Neste bloco (RP) / intercompany como exceção justificada |
| **5 — Evolução** | OFX/CSV, conciliação semiautomática, API bancária, OCR | **Fora** (fronteira do MVP — RCPG033 e §13 do Contexto) |

## 2. Modelo de domínio (objetos separados — Contexto §12.1)

Entidade Legal · Conta Bancária · Fornecedor (+ dados bancários **versionados**) · Natureza Financeira · Centro de Custo · Solicitação de Orçamento (+ propostas de fornecedor) · **Título a Pagar** · Aprovação (motor existente, tipos novos) · Lote de Pagamento (versionado) · Pagamento (execução) · Conciliação · Documento/evidência versionado · Log de auditoria (existente).

**Estados do título** (Processo §3.5): Rascunho → Solicitado → Em validação → (Devolvido) → Aguardando aprovação → Aprovado → Programado → Enviado ao BPO → Aguardando aprovação no Cora → **Pago** → **Conciliado**; terminais: Cancelado; especial: Bloqueado (duplicidade/fraude). *Pago ≠ Conciliado* (RCPG019).

**Estados do lote**: Em preparação → Aprovado → Enviado ao BPO → Cadastrado no Cora → Aguardando aprovação → Aprovado no banco → Parcialmente pago → Pago; Cancelado.

## 3. Regras implementadas (rastreabilidade)

- **RCPG001–003**: entidade obrigatória no título; lote com UMA entidade e UMA conta da própria entidade.
- **RCPG004–006**: natureza + centro de custo antes da aprovação; ativo/placa obrigatório em natureza veicular; produto/operação/cliente/veículo no desembolso RP.
- **RCPG007–010**: fornecedor ATIVO para pagar; Financeiro cadastra / Diretor aprova (dados bancários versionados); segregação solicitante ≠ aprovador (motor existente cobre também o conflito do próprio Diretor).
- **RCPG011–014**: aprovações de orçamento, despesa e lote são eventos distintos (tipos distintos no motor); alçadas por valor **e por tipo** com min/max (decisão 1); natureza especial → Diretor sempre; urgência sem cotação → justificativa + Diretor + lote separado.
- **RCPG015–016**: corte 12h/dia útil no cálculo da data programada.
- **RCPG017–020**: BPO não aprova (não é usuário decisório); eventos Cora manuais; Pago exige comprovante; Conciliado exige extrato; conciliação manual.
- **RCPG021–026**: campos críticos read-only pós-aprovação; alteração crítica = reabertura autorizada pelo Diretor com nova aprovação; nada é apagado; duplicidade bloqueia; alerta no 1º pagamento após troca bancária; documentos versionados.
- **RCPG027–028**: registro oficial no Hub; arquivo/resumo ao BPO versionado por entidade.
- **RCPG029–032**: desembolso de produto ≠ despesa; forma de pagamento ≠ natureza; "Despesas diversas" exige justificativa; adiantamento com prazo de prestação de contas.
- **RCPG033**: sem DRE/fechamento — o módulo entrega fluxo + relatório operacional/exceções e exportação CSV (RF-23/25).
- **RCPG034–035**: reabertura por autorização do Diretor; permissões por papel (matriz existente + área nova "Financeiro administrativo").

## 4. Telas (padrões da proposta UX — tudo por extenso, fila antes de ficha)

1. **Contas a pagar** (área nova no menu): fila de títulos com abas por momento (Para validar · Para aprovar · Programação e lotes · Pagos não conciliados · Todos), criação guiada de despesa/título com dimensões condicionais, ações da etapa sempre visíveis, modais para devolver/bloquear/cancelar/reabrir com "isso vai...".
2. **Fornecedores**: lista com situação; cadastro; dados bancários com histórico de versões; envio para aprovação; alerta de primeiro pagamento.
3. **Orçamentos**: solicitação + propostas lado a lado + decisão; conversão em despesa.
4. **Lotes de pagamento**: formação automática por entidade+conta+data, conferência de total, envio (gera resumo), eventos manuais (cadastrado no Cora, aprovado no banco), versão.
5. **Configuração do financeiro**: entidades legais, contas bancárias, naturezas financeiras, centros de custo organizacionais.
6. **Início**: bloco novo na fila do papel (títulos aguardando validação/aprovação, pagos não conciliados).
7. Aprovações de orçamento/despesa/lote/fornecedor acontecem na **Central de Aprovações existente**.

## 5. Fora do escopo deste bloco (deliberado)

DRE/contábil/fiscal; API bancária e conciliação automática; OCR; portal de fornecedores; orçamento empresarial; rateio automático intercompany (registrado como exceção documentada).

---

*Azit Hub — v0.1 — desenvolvimento autorizado (Luís, 03/08) — divergências corrigem-se após a validação em sistema*
