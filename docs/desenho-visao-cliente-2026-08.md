# Desenho — Visão do Cliente ("Membro") — Azit Hub

**Data:** 03/08/2026 · **Status:** proposta de desenho para validação (decisão 02/08: desenhar antes de desenvolver) · **Base:** aba "Membro" das planilhas do Vicente + arquitetura conta-cêntrica do sistema

Este documento desenha **como o cliente veria** a própria posição — primeiro como **tela interna** ("ver como o cliente") para a operação conferir o que será dito ao cliente, e depois como semente do **portal do titular** (fora do V1). Nada aqui é código: é o desenho para você e o Vicente validarem.

---

## 1. Princípios da visão do cliente

1. **O cliente enxerga a CONTA, não contratos soltos** — uma posição única: "quanto pago por período, o que está pago, o que falta".
2. **Linguagem de gente**: "Sua parcela da semana", "Você já pagou X de Y" — nunca códigos, siglas ou status internos.
3. **Composição sem contabilidade**: a parcela abre em no máximo três linhas — *veículo*, *serviços de consignação* e *proteção* — os mesmos componentes do cronograma da planilha (visão Membro), sem CI/CR/TR.
4. **Nada de dado interno**: sem taxa de remuneração, sem origem de capital, sem alçadas, sem nome de analista (LGPD e proteção do negócio, como na visão do investidor).
5. **Sempre com o próximo passo**: cada tela termina com a ação que interessa ("2ª via do PIX desta semana", "Antecipar parcelas e economizar R$ X").

---

## 2. Tela 1 — "Minha conta" (resumo)

```
┌──────────────────────────────────────────────┐
│  Olá, Marcelo                                │
│                                              │
│  Sua parcela da semana                       │
│  R$ 743,24            vence segunda, 10/08   │
│  [ Pagar com PIX ]  [ Ver boleto ]           │
│                                              │
│  Seu plano                                   │
│  HB20S 2024 · placa ABC1D23                  │
│  ▓▓▓▓▓▓▓░░░░░░░░░░░  42 de 156 parcelas      │
│  Você já pagou R$ 31.216 de R$ 117.935       │
│                                              │
│  Tudo em dia ✓        (ou: 1 parcela atrasada│
│                         — regularize até …)  │
└──────────────────────────────────────────────┘
```

- A barra de progresso usa parcelas pagas ÷ total (todos os contratos da conta consolidados).
- Se houver Reembolso Parcelado ativo, aparece como linha adicional do plano ("+ Reembolso de manutenção — 12 de 26 parcelas").
- Atraso muda o tom da tela inteira (banner âmbar), com o valor atualizado (multa 2% + juros pró-rata) e botão de regularização.

## 3. Tela 2 — "Minhas parcelas" (extrato do cliente = visão Membro da planilha)

```
┌──────────────────────────────────────────────┐
│  Agosto                                      │
│  10/08  R$ 743,24   a vencer                 │
│    Veículo ................. R$ 485,78       │
│    Serviços de consignação . R$ 199,99       │
│    Proteção veicular ....... R$ 57,47        │
│  03/08  R$ 743,24   paga ✓                   │
│  …                                           │
└──────────────────────────────────────────────┘
```

- Cada parcela expande nos **componentes da visão Membro** (veículo / serviços / proteção). Depende do cronograma por componentes (F6 técnica — aguarda a definição do breakdown do recebível com o Sebastião); até lá, a tela interna mostra só o total por parcela.
- Filtros simples: "a vencer", "pagas", "todas". Nada de status internos.

## 4. Tela 3 — "Antecipar e quitar"

```
┌──────────────────────────────────────────────┐
│  Quitar tudo hoje                             │
│  Valor de hoje: R$ 61.480  (economia R$ 9.320)│
│  Na liquidação total você NÃO paga os         │
│  serviços e a proteção das parcelas futuras.  │
│  [ Quero quitar ]                             │
│                                               │
│  Antecipar algumas parcelas                   │
│  (escolha as parcelas; serviços e proteção    │
│   são cobrados integralmente)                 │
└──────────────────────────────────────────────┘
```

- Espelha exatamente as regras da F4 (isenção na liquidação total; parcial cobra cheio) em linguagem de cliente.

## 5. Onde entra primeiro (proposta de fase)

| Passo | O quê | Depende de |
|---|---|---|
| 1 | **Tela interna "ver como o cliente"** na ficha do titular (botão na carteira) com as Telas 1 e 3 | Nada — dados já existem |
| 2 | Tela 2 com componentes | Cronograma por componentes (breakdown do recebível — Sebastião) |
| 3 | Portal do titular (login do cliente) | Decisão de produto/segurança (fora do V1) |

## 6. Perguntas para validação

1. O nome dos componentes para o cliente está bom? ("Veículo / Serviços de consignação / Proteção veicular")
2. A economia da liquidação total deve aparecer com esse destaque, ou é informação só para o operador negociar?
3. O passo 1 (tela interna) entra já no próximo pacote de telas?

---

*Azit Hub — desenho para validação — agosto/2026*
