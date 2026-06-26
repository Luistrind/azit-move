# Doc 3 — Guia Visual e Sistema de Design
## Azit Move V3

**Versão:** 2.0  
**Data:** jun/2025  
**Fontes:** Manual de marca oficial + Protótipo interativo (Claude Design, jun/2025) + Spec de Domínio V3 + Reuniões de 22/06 e 23/06 validadas com Vicente  
**Status:** Aprovado para implementação

---

## Sumário

1. Visão geral
2. Identidade visual
3. Tokens de design
4. Paleta semântica por entidade
5. Componentes base
6. Arquitetura de componentes
7. Estrutura de layout
8. Telas validadas
9. Tela de Acordos / Renegociações
10. Notas de implementação

---

## 1. Visão geral

Este documento é a fonte da verdade para o frontend da plataforma V3. Deve ser lido antes de qualquer código de interface. Define tokens, componentes, padrões de tela e semântica visual derivados do manual de marca, do protótipo aprovado e das especificações de domínio validadas com Vicente.

**Relação com outros documentos:**
- Doc 1 — Design Thinking V3: arquitetura conceitual e fluxos
- Doc 2 — Spec de Domínio V3: entidades, status e regras de negócio
- Doc 3 (este) — como representar visualmente os dados dessas especificações

Quando houver conflito entre o protótipo e os documentos de domínio, **o domínio prevalece**. O protótipo foi gerado antes da validação completa de status com Vicente e contém simplificações que este documento corrige.

---

## 2. Identidade visual

### 2.1 Logo

**Símbolo:** triângulo em formato de seta/montanha com linhas de velocidade, em âmbar. Representa movimento e progressão.

**Wordmark:** "azit" em navy bold + "move" em peso menor, abaixo e à direita do símbolo.

**Fonte de marca:** Nexa Trial Heavy. *Atenção: versão de avaliação com licença limitada. Não embutir em produto web sem licença comercial. Usar Outfit como substituto no produto.*

**Variantes validadas:**
- Sobre fundo branco: símbolo âmbar + wordmark navy
- Sobre `#001029`: símbolo âmbar + wordmark branco
- Sobre foto escura: símbolo âmbar + wordmark branco
- Marca d'água: símbolo do triângulo em cinza muito claro

**Versão no produto (sidebar):**
Na implementação, usar o SVG do símbolo triangular. Enquanto o SVG não estiver disponível, o fallback é um bloco âmbar com a letra "a".

```css
.logo-icon {
  width: 30px; height: 30px; border-radius: 8px;
  background: #FA8E0D;
  font-family: Outfit, sans-serif; font-weight: 800;
  color: #001029; font-size: 17px;
}
.logo-wordmark {
  font-family: Outfit, sans-serif; font-weight: 700;
  font-size: 18px; color: #fff; letter-spacing: -.01em;
}
.logo-accent { color: #FA8E0D; }
```

### 2.2 Cores institucionais

| Token | Hex | Uso |
|---|---|---|
| `--navy` | `#001029` | Cor primária da marca |
| `--accent` | `#FA8E0D` | Cor de ação e energia (configurável) |

### 2.3 Paleta de produto

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#eef1f5` | Background geral da aplicação |
| `--surface` | `#ffffff` | Cards, painéis, modais |
| `--surface-muted` | `#f8fafc` | Cards internos, painéis secundários |
| `--surface-input` | `#f1f4f8` | Inputs, botões secundários |
| `--border` | `#e4e9ef` | Bordas de card e input |
| `--border-light` | `#eef1f5` | Separadores internos |
| `--border-lighter` | `#f4f6f9` | Separadores de lista muito sutis |
| `--text-primary` | `#001029` | Texto principal |
| `--text-body` | `#5b6b7f` | Texto de corpo |
| `--text-secondary` | `#6b7a8c` | Labels de KPI, descrições |
| `--text-muted` | `#9aa7b5` | Metadados, datas |
| `--text-label` | `#8694a4` | Cabeçalhos de tabela |
| `--navy-text` | `#aebccd` | Nav items inativos (sobre navy) |
| `--navy-text-muted` | `#67809a` | Section labels (sobre navy) |
| `--navy-text-meta` | `#9fb0c4` | Metadados (sobre navy) |
| `--navy-text-body` | `#c2cedb` | Corpo (sobre navy) |

### 2.4 Tipografia

#### Fontes do produto (Google Fonts)

| Família | Papel | Pesos |
|---|---|---|
| **Outfit** | Display, títulos, valores numéricos, logo | 400 500 600 700 800 |
| **Manrope** | Todo o restante da UI | 400 500 600 700 |

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
```

#### Escala tipográfica

| px | Família | Peso | Uso |
|---|---|---|---|
| 9 | Manrope | 500 | Eyebrow de subtítulo |
| 10 | Manrope | 600 | Section labels de nav (uppercase) |
| 11 | Manrope | 500 | Metadados, datas |
| 11.5 | Manrope | 600 | Labels de KPI, badges, descrições |
| 12–12.5 | Manrope | 500–700 | Tabelas, cards, nav items |
| 13 | Manrope | 600–700 | Botões, texto de ação |
| 14 | Outfit | 700 | Título de card |
| 15 | Outfit | 700 | Título de painel |
| 16 | Outfit | 700 | Page title |
| 18 | Outfit | 700 | Modal title |
| 19–25 | Outfit | 700 | KPI values |
| 40 | Outfit | 800 | Valor em destaque (tela do cliente) |

---

## 3. Tokens de design

### 3.1 Espaçamento (base 4px)

| Token | Valor | Contexto |
|---|---|---|
| `--space-1` | 4px | Gap interno badge |
| `--space-2` | 8px | Padding badge, gap botões |
| `--space-3` | 12px | Padding nav item |
| `--space-4` | 16px | Padding card padrão |
| `--space-5` | 20px | Padding card maior |
| `--space-6` | 22–24px | Padding sidebar |
| `--space-7` | 26px | Padding lateral main |
| `--space-8` | 28px | Padding modal |

Gap entre cards: `14px` em todos os grids.

### 3.2 Border radius

| Token | Valor | Uso |
|---|---|---|
| `--radius-xs` | 3–4px | Barras de gráfico, dots de legenda |
| `--radius-sm` | 8px | Botão secundário, ícone sidebar |
| `--radius-md` | 10–11px | Botão primário, tab container |
| `--radius-lg` | 14px | Card padrão |
| `--radius-xl` | 16px | Header escuro de contrato |
| `--radius-2xl` | 18px | Modal, header do cliente |
| `--radius-full` | 20px–50% | Badges de status, dots, avatars |

### 3.3 Sombras

| Contexto | Valor |
|---|---|
| Modal | `0 30px 80px rgba(0,16,41,.4)` |
| Card hover | sem sombra — `background: #f8fafc` |

### 3.4 Animações

```css
@keyframes azFade {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
@keyframes azBar {
  from { width: 0; }
}
```

| Uso | Duração |
|---|---|
| Page mount, modal open | `0.28s ease` |
| Barras de progresso | `0.6s ease` |
| Nav items, botões | `0.15s` |
| Linhas de tabela (hover) | `0.12s` |

### 3.5 Scrollbar e seleção

```css
::-webkit-scrollbar        { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb  { background: #cdd6e0; border-radius: 8px; }
::-webkit-scrollbar-track  { background: transparent; }
::selection                { background: #FA8E0D; color: #001029; }
```

---

## 4. Paleta semântica por entidade

A cor comunica estado no sistema. **Separar por entidade é obrigatório** — os status de Parcela, Fatura, Contrato e Acordo são camadas distintas e não devem ser misturados na implementação.

### 4.1 Status de Parcela

Os status marcados com `*` são **calculados em tempo de execução**, não armazenados no banco.

| Status | Background | Foreground | Armazenado? |
|---|---|---|---|
| Em aberto | `#f1f4f8` | `#8694a4` | Calculado* |
| Vence hoje | `#fef6e9` | `#c98a0a` | Calculado* |
| Vencida | `#fef6e9` | `#c98a0a` | Calculado* |
| Paga | `#eafaf1` | `#1f9d5b` | ✓ |
| Paga em atraso | `#eafaf1` | `#1f9d5b` | ✓ |
| Paga antecipada | `#eafaf1` | `#1f9d5b` | ✓ |
| Renegociada | `#efeaff` | `#6b4fd6` | ✓ (permanente) |
| Cancelada | `#fdeceb` | `#e0413c` | ✓ |
| Estornada | `#fdeceb` | `#e0413c` | ✓ |
| Suspensa | `#f1f4f8` | `#9aa7b5` | ✓ |

> **Nota de implementação:** "Paga em atraso" e "Paga antecipada" compartilham a cor verde mas levam um indicador textual diferente. Não usar cores diferentes para diferenciá-las — o contexto já informa.

### 4.2 Status de Fatura

| Status | Background | Foreground |
|---|---|---|
| Aberta | `#f1f4f8` | `#8694a4` |
| Fechada | `#eef1f5` | `#5b6b7f` |
| Vencida | `#fef6e9` | `#c98a0a` |
| Paga | `#eafaf1` | `#1f9d5b` |
| Paga em atraso | `#eafaf1` | `#1f9d5b` |
| Renegociada | `#efeaff` | `#6b4fd6` |

### 4.3 Status de Contrato

**Pré-ativação:**

| Status | Background | Foreground |
|---|---|---|
| Rascunho | `#f1f4f8` | `#8694a4` |
| Aguardando assinatura | `#f1f4f8` | `#8694a4` |
| Aguardando pagamento inicial | `#fef6e9` | `#c98a0a` |
| Aguardando entrega do veículo | `#fef6e9` | `#c98a0a` |

**Em vigor:**

| Status | Background | Foreground |
|---|---|---|
| Ativo | `#eafaf1` | `#1f9d5b` |
| Inadimplente | `#fef6e9` | `#c98a0a` |
| Bloqueado | `#fdeceb` | `#e0413c` |
| Suspenso | `#f1f4f8` | `#9aa7b5` |
| Em recuperação de veículo | `#f3eafb` | `#9a3bd1` |

**Encerramento:**

| Status | Background | Foreground |
|---|---|---|
| Cancelado | `#fdeceb` | `#e0413c` |
| Rescindido | `#f1f4f8` | `#5b6b7f` |
| Quitado (aguardando transferência) | `#eafaf1` | `#1f9d5b` |
| Quitado (transferência efetivada) | `#eafaf1` | `#1f9d5b` |

> **Importante:** Não existe status "Renegociado" no Contrato. Quando um Acordo é efetivado, o contrato retorna a "Ativo". O status "Renegociado" pertence à entidade Acordo, não ao Contrato.

### 4.4 Status de Acordo

| Status | Background | Foreground |
|---|---|---|
| Rascunho | `#f1f4f8` | `#8694a4` |
| Ativo | `#fef6e9` | `#c98a0a` |
| Quitado | `#eafaf1` | `#1f9d5b` |
| Cancelado | `#fdeceb` | `#e0413c` |

### 4.5 Estágios da régua de cobrança

Os estágios abaixo são posições na régua operacional — **não são status de entidade**. São usados exclusivamente nos cards e colunas do kanban da Régua.

| Estágio | Cor |
|---|---|
| D+1 · Cobrança ativa | `#e8920c` |
| D+2 · 2ª tentativa | `#e07a0c` |
| D+3 · Bloqueado | `#e0413c` |
| D+10 · Extrajudicial | `#9a3bd1` |
| D+12 · Recuperação | `#5b6b7f` |

> No D+10 o status do Contrato ainda é "Bloqueado" ou "Inadimplente". O estágio da régua é informação operacional separada, não um campo de status no banco.

### 4.6 Origens de capital

| Origem | Cor |
|---|---|
| Investidor de ativo específico | `#FA8E0D` |
| Fundo coletivo / exclusivo | `#6b4fd6` |
| Capital próprio Azit | `#1f9d5b` |
| Empréstimo / alavancagem | `#4f8af0` |

### 4.7 Componente badge de status

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 20px;
  /* background e color recebem os valores das tabelas acima */
}
.badge__dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
```

---

## 5. Componentes base

### 5.1 Card padrão

```css
.card {
  background: #fff;
  border: 1px solid #e4e9ef;
  border-radius: 14px;
  padding: 18px 20px;
}
.card__title {
  font-family: Outfit, sans-serif;
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 16px;
}
```

### 5.2 KPI Card

```css
.kpi-label {
  font-size: 11.5px; color: #6b7a8c;
  font-weight: 600; letter-spacing: .01em;
}
.kpi-value {
  font-family: Outfit, sans-serif;
  font-weight: 700; font-size: 25px;
  letter-spacing: -.02em; margin: 9px 0 6px;
}
.kpi-delta   { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
.delta-value { font-weight: 600; /* cor via semântica */ }
.delta-note  { color: #9aa7b5; font-weight: 500; }
```

Grid de KPIs: `grid-template-columns: repeat(4, 1fr); gap: 14px;`

### 5.3 Botões

```css
.btn {
  font-family: Manrope, sans-serif; font-size: 13px;
  padding: 11px 20px; border-radius: 10px;
  border: none; cursor: pointer; transition: opacity .15s;
}
.btn:hover { opacity: .88; }

.btn-primary   { background: var(--accent, #FA8E0D); color: #001029; font-weight: 700; }
.btn-secondary { background: #f1f4f8; border: 1px solid #e4e9ef; color: #001029; font-weight: 600; }
.btn-danger    { background: #fdeceb; color: #e0413c; font-weight: 600; }
.btn-ghost     {
  background: transparent; border: 1px solid rgba(255,255,255,.25);
  color: #fff; font-size: 13.5px; font-weight: 600;
  padding: 12px 22px; border-radius: 11px;
}
```

### 5.4 Tabela de listagem

```css
.table-header {
  display: flex; color: #8694a4;
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
  padding: 11px 20px;
}
.table-row {
  display: flex; align-items: center;
  border-top: 1px solid #eef1f5;
  padding: 13px 20px; cursor: pointer;
  transition: background .12s;
}
.table-row:hover    { background: #f8fafc; }
.table-cell-main    { font-weight: 700; font-size: 12.5px; }
.table-cell-sub     { color: #9aa7b5; font-size: 11px; margin-top: 1px; }
.table-cell-value   { font-family: Outfit, sans-serif; font-weight: 700; font-size: 12.5px; }
```

### 5.5 Tabs

```css
.tabs { display: flex; gap: 4px; background: #fff; border: 1px solid #e4e9ef;
        border-radius: 11px; padding: 4px; width: fit-content; margin-bottom: 14px; }
.tab  { font-size: 12.5px; font-weight: 600; padding: 8px 16px; border-radius: 8px; cursor: pointer; border: none; transition: .15s; }
.tab.active   { background: #001029; color: #fff; }
.tab.inactive { background: transparent; color: #5b6b7f; }
```

### 5.6 Kanban — card de cliente

```css
.kanban-card {
  border: 1px solid #eef1f5; border-radius: 11px;
  padding: 12px; background: #fbfcfe; margin-bottom: 9px;
}
.kanban-card__name   { font-size: 12.5px; font-weight: 700; }
.kanban-card__plate  { font-size: 11px; color: #9aa7b5; }
.kanban-card__model  { font-size: 11px; color: #6b7a8c; margin-bottom: 9px; }
.kanban-card__value  { font-family: Outfit, sans-serif; font-weight: 700; font-size: 13px; }
.kanban-card__tag    { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
```

### 5.7 Kanban — coluna

```css
.kanban-col {
  flex: none; width: 248px; background: #fff;
  border: 1px solid #e4e9ef; border-radius: 14px;
  display: flex; flex-direction: column; max-height: 560px;
}
.kanban-col__header {
  padding: 14px 16px; border-bottom: 1px solid #eef1f5;
  display: flex; align-items: center; gap: 9px; flex: none;
}
.kanban-col__dot   { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.kanban-col__title { font-size: 12.5px; font-weight: 700; flex: 1; }
.kanban-col__desc  { font-size: 10.5px; color: #9aa7b5; margin-top: 2px; }
.kanban-col__count { font-family: Outfit; font-weight: 700; font-size: 14px; }
.kanban-col__body  { padding: 11px; overflow: auto; flex: 1; }

.kanban-board { display: flex; gap: 13px; overflow-x: auto; padding-bottom: 8px; }
```

### 5.8 Modal

```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,16,41,.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 50; animation: azFade .2s ease both;
}
.modal-box {
  background: #fff; border-radius: 18px;
  padding: 26px 28px;
  box-shadow: 0 30px 80px rgba(0,16,41,.4);
  width: 460px; position: relative;
}
.modal-title    { font-family: Outfit, sans-serif; font-weight: 700; font-size: 18px; margin-bottom: 4px; }
.modal-subtitle { font-size: 12.5px; color: #6b7a8c; margin-bottom: 20px; }
.modal-close    { position: absolute; top: 26px; right: 28px; font-size: 18px; color: #9aa7b5; cursor: pointer; background: none; border: none; }
```

### 5.9 Barras de progresso

```css
.progress-track { height: 7px; background: #eef1f5; border-radius: 5px; overflow: hidden; }
.progress-fill  { height: 100%; border-radius: 5px; animation: azBar .6s ease; }

/* Barra segmentada (saúde da carteira) */
.progress-segmented { display: flex; height: 13px; border-radius: 7px; overflow: hidden; margin-bottom: 18px; }
```

### 5.10 Header escuro (entity header)

```css
.entity-header {
  background: #001029; color: #fff; border-radius: 16px;
  padding: 22px 24px; margin-bottom: 14px;
  position: relative; overflow: hidden;
}
.entity-header__glow {
  position: absolute; right: -30px; top: -30px;
  width: 160px; height: 160px; border-radius: 50%;
  background: radial-gradient(circle, rgba(250,142,13,.22), transparent 70%);
  pointer-events: none;
}
.entity-header__meta   { font-size: 11.5px; color: #9fb0c4; }
.entity-header__name   { font-family: Outfit; font-weight: 700; font-size: 23px; margin: 5px 0 3px; }
.entity-header__sub    { font-size: 12.5px; color: #c2cedb; }
.entity-header__metrics { display: flex; gap: 30px; margin-top: 22px; position: relative; }
.entity-header__metric-label { font-size: 11px; color: #9fb0c4; }
.entity-header__metric-value { font-family: Outfit; font-weight: 700; font-size: 19px; margin-top: 3px; }
/* Próxima fatura: color: #FA8E0D */
```

### 5.11 Input de busca

```css
.search-box {
  display: flex; align-items: center; gap: 8px;
  background: #f1f4f8; border: 1px solid #e4e9ef;
  border-radius: 10px; padding: 8px 12px;
  width: 240px; color: #8694a4; font-size: 12.5px;
}
```

### 5.12 Linha de evento (extrato)

```css
.extrato-row    { display: flex; align-items: center; gap: 14px; padding: 13px 20px; border-bottom: 1px solid #f4f6f9; }
.extrato-icon   { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex: none; }
.extrato-label  { font-size: 13px; font-weight: 600; }
.extrato-date   { font-size: 11px; color: #9aa7b5; }
.extrato-amount { font-family: Outfit; font-weight: 700; font-size: 13.5px; }
```

---

## 6. Arquitetura de componentes

**Princípio obrigatório:** componentes são genéricos e configurados via props. Nunca criar um componente para cada caso de uso. O que muda entre contextos é o dado passado, não o componente.

### 6.1 Separação entre componente e dado de domínio

O componente conhece estrutura e estilo. O dado de domínio (status, rótulos, cores) é passado via props.

**Exemplo correto:** o componente `<KanbanBoard>` recebe `colunas[]` como prop. Para a Régua de cobrança, as colunas são os estágios D+1 a D+12. Para Acordos, as colunas são os status do Acordo. **O componente é o mesmo.**

**Exemplo incorreto:** criar `<KanbanRegua>` e `<KanbanAcordos>` como componentes separados.

### 6.2 Composição sobre herança

Componentes menores compõem os maiores:

```
KanbanBoard
  └── KanbanColuna (recebe: título, cor, count, cards[])
        └── KanbanCard (recebe: nome, sub, valor, tag, tagColor)

StatusBadge (recebe: label, bg, fg)

TabContainer
  └── Tab (recebe: label, active, onClick)
```

### 6.3 Tokens como fonte única de estilo

Cores, espaçamentos e radii vêm sempre dos tokens CSS definidos na seção 3. Nunca hardcodar valores de cor diretamente em componentes — isso garante que uma mudança de token propague para todo o sistema.

```css
/* ✓ Correto */
background: var(--accent);

/* ✗ Incorreto */
background: #FA8E0D;
```

### 6.4 Responsabilidade única por componente

Cada componente tem uma função visual e recebe os dados necessários via props. Lógica de negócio, cálculos e chamadas de API ficam fora do componente de apresentação.

---

## 7. Estrutura de layout

### 7.1 Shell da aplicação

```
┌──────────────────────────────────────────────────────────┐
│  Sidebar (236px fixo, background: #001029)               │
│  Logo · Personas · Nav · User footer                     │
├──────────────────────────────────────────────────────────┤
│  Topbar (height: 60px, background: #fff)                 │
│  Page title + sub · [espaço] · Search · Notif           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Scroll area (flex:1, overflow: auto)                    │
│  padding: 24px 26px 40px                                 │
│  background: #eef1f5                                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 7.2 Sidebar

```css
.sidebar { width: 236px; flex: none; background: #001029; color: #fff; display: flex; flex-direction: column; }
.sidebar-logo     { padding: 22px 22px 18px; display: flex; align-items: center; gap: 10px; }
.sidebar-divider  { height: 1px; background: rgba(255,255,255,.08); margin: 6px 16px 12px; }
.sidebar-section-label { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #67809a; margin: 10px 8px 8px; }

.persona-btn { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 9px; font-size: 12.5px; font-weight: 600; border: none; cursor: pointer; background: transparent; transition: background .15s; }
.persona-btn.active  { background: rgba(250,142,13,.14); color: #FA8E0D; }
.persona-btn.inactive { color: #aebccd; }
.persona-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }

.nav-item { display: flex; align-items: center; gap: 11px; padding: 10px 11px; border-radius: 9px; font-size: 13px; border: none; cursor: pointer; width: 100%; text-align: left; transition: .15s; }
.nav-item.active   { background: rgba(255,255,255,.08); color: #fff; font-weight: 700; }
.nav-item.inactive { color: #aebccd; font-weight: 500; }
.nav-icon  { font-family: Outfit; font-size: 13px; width: 18px; text-align: center; }
.nav-count { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 20px; }

.sidebar-footer { padding: 14px 18px; border-top: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 10px; }
.user-avatar    { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #FA8E0D, #d97206); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; color: #001029; }
```

### 7.3 Topbar

```css
.topbar { height: 60px; flex: none; background: #fff; border-bottom: 1px solid #e4e9ef; display: flex; align-items: center; gap: 18px; padding: 0 26px; }
.topbar-title { font-family: Outfit; font-weight: 700; font-size: 16px; letter-spacing: -.01em; line-height: 1.1; }
.topbar-sub   { font-size: 11.5px; color: #6b7a8c; margin-top: 1px; }
.topbar-notif-btn { width: 38px; height: 38px; border-radius: 10px; background: #f1f4f8; border: 1px solid #e4e9ef; position: relative; cursor: pointer; }
.topbar-notif-dot { position: absolute; top: 7px; right: 8px; width: 7px; height: 7px; border-radius: 50%; background: #e0413c; border: 1.5px solid #fff; }
```

### 7.4 Grids mais usados

```css
.grid-4       { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.grid-3       { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.grid-detail  { display: grid; grid-template-columns: 1fr 320px; gap: 14px; align-items: start; }
.grid-wide-narrow { display: grid; grid-template-columns: 1.55fr 1fr; gap: 14px; }
.grid-narrow-wide { display: grid; grid-template-columns: 1fr 1.3fr; gap: 14px; }
.grid-two     { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
```

---

## 8. Telas validadas

Estas telas foram aprovadas em jun/2025. Os labels de status usados abaixo seguem a nomenclatura da Spec de Domínio V3, corrigindo simplificações do protótipo original.

### 8.1 Carteira Operacional *(default da persona Operação)*

```
Row 1: 4 KPI Cards (grid-4)
Row 2: "Saúde da carteira" (1.55fr) + "Origem de capital" (1fr)
Row 3: Tabela "Portfólio de contratos" (full width)
```

**KPIs:** Carteira sob gestão · Contratos ativos · Inadimplência · Recebido na semana

**Saúde da carteira:** barra segmentada `height 13px` + legenda grid 2 colunas. Estágios: Em dia · D+1/D+2 · Bloqueado D+3 · Extrajudicial · Recuperação. Cores conforme seção 4.5.

**Tabela de contratos:**
- Colunas flex: `Cliente (1.6) · Ativo (1.4) · Parcela (.8) · Saldo devedor (1.1) · Capital (.9) · Status (1.1)`
- Coluna Status: badge do **status do Contrato** (seção 4.3)
- Formato do número de parcela: `12/157` (posição atual / total)
- Clique na linha → abre tela 8.2

### 8.2 Detalhe do Contrato

**Layout:** `grid-detail` (1fr / 320px)

**Coluna esquerda:**

Entity header escuro (seção 5.10):
- Meta: id + placa
- Nome do cliente (23px Outfit)
- Sub: modelo do ativo + data de origem
- Badge do **status do Contrato** (canto superior direito)
- 4 métricas: Saldo devedor · Parcela `12/157` · Próxima fatura (âmbar) · Origem de capital

Tabs: Cronograma / Recebíveis / Extrato

**Tab Cronograma:**

Tabela com colunas: `Parcela (.8) · Vencimento (.9) · Valor (.8) · Composição (1.4) · Status (.9)`

- Coluna "Parcela": formato `10/157`, `11/157`, etc.
- Coluna "Composição": descrição textual do que compõe o recebível. **⚠️ Placeholder** — fórmula de breakdown (amortização + rendimento + taxa de serviço) está pendente de definição com Sebastião (estrutura jurídica do fundo). Usar texto genérico como "Principal + serviços" até formalização.
- Coluna "Status": badge do **status da Parcela** (seção 4.1) com labels corretos:
  - Parcelas pagas → `Paga` (verde)
  - Parcela vencida sem pagamento → `Vencida` (âmbar)
  - Parcelas futuras → `Em aberto` (cinza)

**Tab Recebíveis (Breakdown):**

Barras de progresso com percentuais dos destinos financeiros. **⚠️ Placeholder** — os valores de breakdown (amortização / rendimento / taxa Azit) e seus percentuais são fictícios no protótipo. A fórmula real depende da decisão de Sebastião sobre a estrutura jurídica do fundo. Esta tab deve exibir placeholder visual ou ser omitida até que a fórmula seja definida.

Mini-cards de totalizadores abaixo das barras: Capital amortizado · Rendimento realizado · Taxa de serviço Azit. Mesma nota de placeholder.

**Tab Extrato:**
Lista de eventos com ícone-bloco colorido 34px + label + data + valor. Cor do valor: verde para entradas, âmbar para alertas, cinza para sistema.

**Coluna direita (sticky):**

Card "Ações":
- `Renegociar contrato` → btn-primary (abre modal do Acordo)
- `Quitação antecipada` → btn-secondary
- `Bloquear veículo` → btn-danger

Card "Posição na régua":
- Painel colorido com dot + estágio + ação em curso
- Cor segue paleta da régua (seção 4.5)
- Exemplo: "D+1 · Cobrança ativa / Bot iniciou contato via WhatsApp"

### 8.3 Régua de cobrança (Kanban) ✅ APROVADO

**Nota:** este padrão kanban é exclusivo desta tela. A tela de Acordos usa o mesmo componente com dados diferentes — ver seção 9.

`KanbanBoard` com 5 colunas, configuração:

| Coluna | Estágio | Cor |
|---|---|---|
| 1 | D+1 · Cobrança ativa | `#e8920c` |
| 2 | D+2 · 2ª tentativa | `#e07a0c` |
| 3 | D+3 · Bloqueado | `#e0413c` |
| 4 | D+10 · Extrajudicial | `#9a3bd1` |
| 5 | D+12 · Recuperação | `#5b6b7f` |

Cada coluna: header com dot + título + desc + count. Body scrollável com cards de cliente.

### 8.4 Visão do Cliente

**Max-width: 760px**

Header destaque escuro (`border-radius: 18px`):
- Saudação + valor da próxima fatura em 40px Outfit 800
- Vencimento em destaque âmbar
- 2 CTAs: "Pagar com Pix" (btn-primary) + "Quitar antecipado" (btn-ghost)

Grid 3 colunas (métricas): Saldo devedor total · Parcelas pagas (`12/157`) · Valor p/ quitar hoje (verde `#1f9d5b`)

Lista "Meus contratos": ícone 38×38px + label + sub + valor/posição alinhados à direita. Cada linha corresponde a um ItemContratado ativo do cliente — incluindo os itens de origem "renegociacao", que aparecem como uma linha própria (ex: "Crédito de renegociação · Acordo nº X") ao lado dos produtos de venda.

### 8.5 Investidor de Ativo Específico

> Esta é uma visão acessada pelo titular que possui um `ContratoInvestimento` do tipo ativo específico. Os dados vêm do contrato de investimento dele e do `ContratoCredito` que aquele capital financia (via OrigemCapital). "Investidor" aqui é o papel do titular, não uma entidade separada.

Grid 4 KPIs: Capital investido · Capital amortizado · A amortizar · Rendimento realizado

Grid `1.4fr / 1fr`:

Painel "Capital · realizado vs esperado":
- Barras agrupadas por mês (8 meses), altura variável, container 180px
- Barra âmbar `#FA8E0D` (realizado) + barra cinza `#dfe6ee` (esperado)
- Legenda com dots abaixo

Painel "Contrato vinculado":
- Lista chave-valor: Cliente · Status do contrato · Parcela atual · Rendimento esperado · Rendimento realizado
- Footer: nota verde de projeção de encerramento

### 8.6 Investidor de Fundo

Grid 4 KPIs: Capital alocado · Retorno médio · Inadimplência · Rendimento 12m

Grid `1fr / 1.3fr`:

Painel "Composição dos contratos": barras horizontais de progresso por categoria de veículo.

Painel "Retorno do fundo · 12 meses": barras verticais com gradiente `linear-gradient(180deg, #FA8E0D, #f0a93f)` por mês.

### 8.7 Fluxo de sinistro

O fluxo de sinistro foi definido na reunião de 23/06 com Vicente e deve ser suportado no sistema. **Não está mais em aberto.**

**Regras definidas:**
- A dívida do cliente não é perdoada pelo sinistro
- Cliente permanece responsável pelo pagamento
- O seguro deve ser acionado — a Azit consta como beneficiária
- A indenização recebida amortiza o saldo devedor do contrato
- Se a indenização superar o saldo, o excedente pertence ao cliente
- Se for insuficiente, o saldo remanescente continua obrigação do cliente

**Impacto em tela:** o detalhe do contrato deve suportar o registro de um sinistro (botão na área de Ações) que abre um modal com: data do sinistro, valor da indenização, cálculo de amortização e saldo resultante.

---

## 9. Tela de Acordos / Renegociações

### 9.1 Separação da Régua

A seção "Renegociações" no nav é uma tela distinta da Régua de cobrança. Usam o mesmo componente `KanbanBoard`, mas com configurações diferentes passadas via props.

**Régua:** recebe os estágios D+1 a D+12 com contratos inadimplentes.

**Acordos (se usar kanban):** recebe os status do Acordo (Rascunho, Ativo, Quitado). Alternativamente, pode ser uma listagem tabular — mais simples e suficiente para o volume atual.

> **Como a renegociação aparece no contrato do cliente:** quando um acordo é efetivado, ele gera um item de crédito próprio dentro do contrato (origem "renegociacao"), no modelo de novação bancária. No extrato e no cronograma do contrato, esse acordo aparece como uma **linha de crédito própria** — por exemplo "Crédito de renegociação · Acordo nº X" — com suas parcelas numeradas 1/12, 2/12. As parcelas antigas extintas aparecem marcadas como "Renegociada". A interface deve deixar visível que a dívida nova é um item distinto, não uma alteração das parcelas originais.

### 9.2 Tela: Lista de Acordos

**Layout:**
```
KPIs (3 cards): Acordos ativos · Aguardando entrada · Quitados no mês
Tabela de Acordos (full width)
```

**Tabela — colunas:**
`Cliente (1.4) · Contrato (.8) · Tipo (1.0) · Entrada (1.0) · Parcelas do acordo (.9) · Status (.9) · Criado em (.8)`

- Coluna "Tipo": "Renegociação menor" ou "Repactuação radical"
- Coluna "Status": badge do **status do Acordo** (seção 4.4)

### 9.3 Modal de renegociação *(acessado a partir do detalhe de contrato)*

Tamanho: `width: 520px`. Estrutura em 3 etapas com barra de progresso do wizard.

**Etapa 1 — Selecionar obrigações:**
- Lista de itens/faturas em aberto com checkboxes
- Seleção pode ser por item (parcela 14, parcela 15, parcela de pneu) ou por fatura (fatura 30, fatura 31)
- Rodapé dinâmico: "Saldo selecionado: R$ X.XXX"

**Etapa 2 — Configurar acordo:**
- Tipo: 2 radio cards
  - "Renegociação menor" — parcelas atrasadas diluídas em novas parcelas
  - "Repactuação radical" — liquida contrato antigo e cria novo
- Entrada: input numérico com validação mínimo 30% do saldo
- Parcelas do acordo: seletor (6 / 12 / 24 / 36)
- Resumo dinâmico calculado em tempo real

**Etapa 3 — Confirmar:**
- Resumo final somente leitura
- Botão "Gerar link de entrada" → cria cobrança avulsa no Asaas
- Estado: Acordo fica em "Rascunho" até pagamento da entrada
- Efetivação automática via webhook de confirmação do Asaas

---

## 10. Notas de implementação

### 10.1 Accent configurável

```css
:root { --accent: #FA8E0D; }
```

O accent é uma CSS variable. O protótipo oferece 4 opções. Na V3 manter como variável para personalização futura por ambiente ou tenant.

### 10.2 Fontes web

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### 10.3 SVG do logo

Solicitar ao designer o arquivo SVG do símbolo triangular para uso no app. O fallback (letra "a" em bloco âmbar) é aceitável apenas em ambiente de desenvolvimento.

### 10.4 Personas em produção

O switcher de persona na sidebar é apenas um recurso de demonstração. Em produção o perfil vem do backend — o JWT do usuário autenticado determina o contexto. O mapeamento entre personas e roles de sistema deve ser definido em conjunto com o Vini no momento da implementação da autenticação, não neste documento.

### 10.5 Responsividade

| Tela | Breakpoint |
|---|---|
| Operação / Investidor | Desktop only — mínimo 1280px |
| Visão do Cliente | Mobile-first — mínimo 375px |

### 10.6 Placeholders documentados

Os seguintes itens no protótipo são dados fictícios. Devem ser identificados visualmente como placeholders até definição formal:

| Item | Pendência |
|---|---|
| Percentuais de breakdown (69%/19%/12%) | Depende de decisão do Sebastião sobre estrutura jurídica do fundo |
| Coluna "Composição" na Tab Cronograma | Mesma dependência |
| Tab "Recebíveis" completa | Mesma dependência |

### 10.7 Stack de referência

```
TypeScript · NestJS · Next.js + React · Tailwind CSS · PostgreSQL + Prisma ORM
```

Mapeamento sugerido de tokens para `tailwind.config.js`:

```js
theme: {
  extend: {
    colors: {
      navy:    '#001029',
      accent:  '#FA8E0D',
      'app-bg': '#eef1f5',
    },
    fontFamily: {
      display: ['Outfit', 'sans-serif'],
      body:    ['Manrope', 'system-ui', 'sans-serif'],
    },
    borderRadius: {
      card:  '14px',
      modal: '18px',
    }
  }
}
```

---

*Doc 3 — Guia Visual V3 · Azit Move · v2.0 · jun/2025*
*Documentos relacionados: Doc 1 — Design Thinking V3 · Doc 2 — Spec de Domínio V3 · API Spec V1.1*
