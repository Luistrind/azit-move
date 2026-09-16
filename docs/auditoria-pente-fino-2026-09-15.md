# Auditoria pente-fino — 15/09/2026

Pedido do Luís: "identificar as coisas que estão duplicadas, ou que é a mesma coisa e está
usando fluxo diferente… todos os fluxos existentes, os que estão incompletos, o que não dá
em lugar nenhum". Método: três varreduras completas (telas/ações; endpoints × consumo;
máquinas de estado/fluxos) + verificação manual de cada achado crítico no código e, quando
cabível, em produção (somente leitura). Cada item traz arquivo:linha.

Estado em produção verificado em 15/09: matriz de alçadas ÍNTEGRA (39 células, todos os
tipos de operação cobertos); `/dev/*` FECHADOS (NODE_ENV=production + DevOnlyGuard→404);
nenhum resíduo da novação 1:1 antiga; renegociação já 100% conta-cêntrica.

---

## P0 — Segurança e integridade (corrigir antes de dado real)

> **BLOCO A EXECUTADO (15/09, mesmo dia):** itens 1–6 corrigidos. 1: webhooks
> recusam em produção sem segredo configurado. 2: seed aditivo (upsert), chaves
> órfãs `despesa`/`venda` removidas do seed. 3: `ativacao:` + PAYMENT_OVERDUE
> alerta a carteira (expiração automática fica para o Bloco B). 4 e 5: rotas
> removidas. 6: crons de fechamento e régua passaram a ENFILEIRAR (retry do
> worker + jobId diário deduplica réplicas). Pós-deploy, CONFERIR no VPS a
> presença dos segredos: `grep -c ASAAS_WEBHOOK_SECRET /opt/azit/stack.env` e
> `grep -c ZAPSIGN_WEBHOOK_SECRET /opt/azit/stack.env` (ambos devem ser ≥1 e
> com valor não vazio — sem imprimir o valor).

1. **Webhooks aceitam payload anônimo se o segredo não estiver configurado.**
   `cobranca/webhook.controller.ts:42` e `assinatura/assinatura.controller.ts:77` usam
   `if (segredo && …)` — sem segredo, qualquer POST é aceito. `ZAPSIGN_WEBHOOK_SECRET` é
   OPCIONAL no stack (`deploy/azit-stack.swarm.yml:62`, `:-`): se não estiver no stack.env,
   **qualquer pessoa que conheça a URL pode marcar contratos como assinados** (dispara
   ativação de RP/novação). Correção: em produção, segredo ausente = webhook recusa (500 no
   boot ou 401 sempre). Conferir também a presença de `ASAAS_WEBHOOK_SECRET` no stack.env.

2. **`seed.ts` apaga a matriz de alçadas.** `prisma/seed.ts:514` faz `alcada.deleteMany({})`
   e recria só 7 tipos (`:489-501`) — as alçadas de `analise_cadastro` (COCAD),
   `condicao_fora_parametro` e todas as de contas a pagar vêm de MIGRAÇÕES e seriam
   destruídas por qualquer `db seed` futuro. Sem alçada, `decidir` lança `fora_da_alcada`
   (`aprovacao.service.ts:151`) e a aprovação fica PENDENTE para sempre. Correção: seed
   ADITIVO (upsert por chave), nunca deleteMany. Bônus: remover as chaves órfãs `despesa` e
   `venda` (`seed.ts:498-499`) — nenhum código as usa e produção tem células para elas.

3. **Boleto de ativação vencido não tem tratamento.** `webhook.controller.ts:83-101`:
   `PAYMENT_OVERDUE` de `ativacao:` cai no else final e vira job `PAGAMENTO_VENCIDO` com
   `faturaId="ativacao:…"` — falha 5× e morre. O contrato fica em
   `AGUARDANDO_PAGAMENTO_INICIAL` para sempre (acordo e novação têm o par de expiração;
   contrato não). Correção: handler + expiração do contrato (par do item B.1).

4. **`POST /contratos` cria contrato fora da esteira de crédito.**
   `contrato/contrato.controller.ts:26` — órfão (nenhuma tela chama), acessível a OPERADOR,
   pula análise/alçada/catálogo congelado. Correção: remover a rota (o funil formaliza).

5. **`GET /auth/admin-check`** (`auth.controller.ts:58`) — endpoint de teste de guard vivo.
   Remover.

6. **Filas `FECHAR_FATURA` e `REGUA_STEP` têm worker e nenhum produtor.**
   `cobranca.processors.ts:33`, `regua.processor.ts:8` — os crons chamam os services
   direto, in-process, sem retry/backoff e sem lock (com N réplicas rodariam N×). Hoje (1
   réplica) funciona; resolver antes de escalar: ou o cron enfileira, ou remove-se
   worker+fila.

## P1 — Becos sem saída operacionais

7. **`AGUARDANDO_ASSINATURA` não tem saída** (venda, RP, e os DOIS contratos da novação):
   sem expiração, sem cancelamento, sem reenvio com prazo — `credito.service.ts:541` só
   cancela RASCUNHO; a recusa na ZapSign não altera o contrato
   (`assinatura.service.ts:366`); o ativo fica preso `EM_CONTRATO`
   (`contrato.service.ts:172`). Novação idem: `novacao.service.ts:536` (`cancelar`) não é
   exposto por endpoint/botão. **Decisão de domínio necessária (doc 02): prazo de validade
   da assinatura + ação manual de cancelar.**

8. **`condicao_fora_parametro`: reprovação sem efeito.** Sem efetivador
   (`aprovacao.service.ts:220` warn); `Proposta.foraParametro` não pode ser desmarcado
   (só leituras). Reprovar a exceção não devolve nada ao operador.

9. **Pendências e ressalvas da análise nunca expiram.** Prazo em dias úteis gravado
   (`analise.service.ts:841`, `:986`) e descartado — `EXPIRADA` (pendência e ressalva)
   nunca é escrita; não há cron nem botão.

10. **Telas que terminam em nada**: lote em `APROVADO_BANCO`/`PAGO` sem ação nem explicação
    (`ContasPagarPage.tsx:659-665`); acordo/novação `EXPIRADO` sem ação
    (`AcordosPage.tsx:128`); simulação encerrada sem proposta = linha inerte
    (`SimulacoesPage.tsx:39-44`); notificação de fatura vencida aponta `/regua` mas a
    reemissão vive na ficha do titular (`fatura.service.ts:106,115`).

11. **Meio-construídos**: `AlertaFraude` — o gate de liberação lê
    (`analise.service.ts:1195`) mas NADA cria/resolve o alerta (feature 50%);
    `PENDENTE_COMPLEMENTO_COCAD` — UI pronta (`AnalisePage.tsx:86,131`), backend nunca
    produz; `AGUARDANDO_ENTREGA_VEICULO` — rótulo/cor/filtro prontos, nunca escrito;
    módulo `investimento` inteiro órfão (5 endpoints; `TitularPage.tsx:171` renderiza o
    título "Contratos de investimento" sem chamar a API).

12. **Previsão de caixa suja**: `StatusRecebivel.CANCELADO` nunca escrito — recebível de
    contrato cancelado permanece `ESPERADO`; `ItemContratado` nunca muda de status
    (nenhum update no backend).

## P2 — Duplicações de conceito (a raiz dos bugs recorrentes)

13. **DOIS motores de precificação da venda.** `VersaoParametrosSimulacao` (legado) ×
    Catálogo `compra_parcelada` — mesmos conceitos em duas tabelas
    (`catalogo-fonte.service.ts:26-52` × `schema.prisma:498-522`). E o modo Catálogo
    VAZA legado: `simulacao.service.ts:217-220` grava `entradaMinima`, `validadeDias` e
    `parametroVersaoId` SEMPRE do motor legado, e `vigente()` lança erro sem versão legada
    cadastrada — o simulador não funciona em "Catálogo puro". **Decisão: aposentar o motor
    legado (migrar validade/entrada p/ Catálogo) ou assumir a dupla fonte com sincronia.**

14. **Fator semanal: 3 valores em 5 lugares.** 4,3452/2,1726 (`packages/utils/novacao.ts:11`
    — fonte única declarada) × 4,345/2,1725 (`VersaoParametrosSimulacao`) ×
    4,345/2,17 (`VersaoParametrosAnalise` + hardcode em
    `assistente-analise.service.ts:214`) × fator de VALOR 4/2 duplicado (const TS
    `FATORES_CATALOGO` + colunas configuráveis do legado). Unificar na fonte única.

15. **Proteção veicular: 3 fontes.** `protS` congelado na ref × `protecaoMensal` chumbado
    (declarado morto em `catalogo-fonte.service.ts:362` mas AINDA lido em `:109,137`) ×
    cálculo do produto PV. É a explicação provável da divergência real observada
    (venda 86,24 × novação 73,98 para o mesmo Polo). Matar o chumbado de vez e auditar
    onde cada fluxo pega a proteção.

16. **Juros/multa de atraso: 4 definições + 1 reimplementação.** Default 2/1 no schema,
    em `calculations.ts:43`, em `novacao.ts:143`, fallback em
    `formalizacao.service.ts:392`; `renegociacao.service.ts:212-218` reimplementa a
    fórmula em vez de chamar `calcularEncargoAtraso`. E "taxa por contrato" é ilusória:
    só a originação PopHub preenche os campos.

17. **Dois catálogos de produto**: `/produtos` (model `Produto`, legado §9 — "Itens
    avulsos de contrato") × `/catalogo` (`ProdutoCatalogo`). Sem ponte. Decidir o destino
    do legado.

18. **Três listas de titular** (`/carteira`, `/titulares`, `/pessoas`) e a edição de
    cadastro SÓ em `/titulares` (`TitularPage.tsx:117`) — o hub (`TitularDetalhePage`)
    mostra tudo somente-leitura, sem botão editar.

19. **CR da novação com 3 fallbacks silenciosos** (produto → CR da venda → literal 79996,
    `catalogo-fonte.service.ts:241-252`; introduzido na F4 de 15/09). Funcional por
    desenho (Regra 12), mas o parâmetro precisa aparecer na tela do Catálogo.

## P3 — UI e higiene

20. "Liberar para formalização" DUPLICADO simultâneo na mesma tela
    (`AnalisePage.tsx:536` e `:699`).
21. "Abrir análise →" que abre a PROPOSTA (`PropostasPage.tsx:88`); banner "Abrir análise"
    renderizado em todos os passos sem guard (`PropostaDetalhePage.tsx:330-342`).
22. "Rodar régua (dev)" SEM gate `import.meta.env.DEV` (`ReguaPage.tsx:181-189`) — único
    botão dev visível em produção.
23. `/acordos` em produção não tem NENHUMA ação de negócio (só links); banners descrevem o
    caminho sem link (`AcordosPage.tsx:80-96`).
24. Cache órfão: `invalidateQueries(['contrato-detalhe'])` — chave que nenhum useQuery usa
    (`ContratoDetalhePage.tsx:46`, `BlocoAssinaturaDigital.tsx:41`) → a tela NÃO reflete a
    assinatura sem F5.
25. `Modal` reimplementado à mão 2× sem Esc (`RenegociacaoWizard.tsx:136`,
    `PropostaDetalhePage.tsx:606`); `window.prompt/alert` no sinistro/reajuste contra o
    princípio P6 declarado na própria tela (`ContratoDetalhePage.tsx:111,135,153`);
    `window.confirm` com 3 textos diferentes para remover documento.
26. Router sem catch-all/errorElement (`router.tsx`) — URL errada = tela de erro crua (já
    causou o bug real da listagem de simulações); 5 telas sem título (topbar "Azit Move"
    e sem h1: /simulacoes, /propostas, /titulares, /ativos, /produtos); 8 títulos
    duplicados topbar+h1; 6 nomes para o conceito acordo/renegociação.
27. Cores ausentes p/ 5 status de lote (`statusColors.ts:133-146`); mutações
    fire-and-forget sem catch na `CatalogoPage.tsx:82,97`; rotas de notificação de
    aprovação com chaves erradas ('despesa'/'orcamento' — `aprovacao.service.ts:62-69`).
28. Inventário de mortos: 24 valores de enum nunca escritos (lista na varredura de
    domínio, §1.11); 21 endpoints órfãos sem tela; `PlaceholderPage.tsx` morto;
    `POST /cobrancas/varrer` operacional sem tela (ADMIN, prod).

---

## Plano de correção proposto (blocos, em ordem recomendada)

- **Bloco A — Segurança (P0 1–5):** pequeno e imediato; sem decisão de domínio.
- **Bloco B — Saídas dos estados (P0 3 + P1 7–9):** expiração de assinatura/entrada +
  cancelar novação/contrato + expiração de pendências/ressalvas. Exige UMA decisão de
  domínio (prazos) → doc 02 antes do código.
- **Bloco C — Unificação de fontes (P2 13–16):** o de maior valor estrutural; exige a
  decisão "aposentar o motor legado de parâmetros". Elimina a CLASSE dos bugs de
  divergência (proteção, fatores, entrada mínima).
- **Bloco D — UI: becos e duplicatas (P3 20–27 + P1 10):** rápido, muitos ganhos de
  confiabilidade percebida.
- **Bloco E — Limpeza (P3 28 + P1 11–12 + P2 17–18):** enums/endpoints/módulos mortos —
  decidir o que é "futuro planejado" (guardar com marca) e o que remove.

Nada deste relatório foi corrigido ainda, exceto o que já saiu hoje (ciclo do produto
adicional; modal do acordo duplicado; F4). Fila `FECHAR_FATURA`/`REGUA_STEP` e webhooks: ver
Bloco A.
