# Definições Pendentes para Fechar o MVP — Azit Hub

> Levantamento de 14/07/2026, a partir do documento **"Escopo MVP Azit Hub"**. Cruza o escopo obrigatório do MVP com tudo que roda de **provisório** (placeholder) no sistema hoje. A conclusão central: o que falta para liberar a homologação com usuários-chave **não é código — é decisão**. Este documento organiza essas decisões com dono e efeito, para servir de pauta.

O material está em quatro blocos: (1) definições que **travam desenvolvimento** de itens obrigatórios; (2) placeholders que podem ir à homologação como estão, **mediante aceite explícito**; (3) logística da homologação; (4) o que já está decidido e não precisa voltar à mesa.

---

## 1. Definições que travam DESENVOLVIMENTO de itens obrigatórios

Sem estas definições, o escopo obrigatório do MVP não fecha — o mecanismo técnico existe ou é rápido de construir, mas a regra é de negócio.

| # | Definição pendente | Dono sugerido | O que destrava / o que está provisório hoje |
|---|---|---|---|
| D1 | **Política de análise de cadastro** — critérios objetivos: renda mínima, % parcela/renda, CNH, extratos de apps, o que reprova e o que gera ressalva | Vicente + time de crédito | A **capacidade de pagamento é o maior placeholder do sistema** — hoje a decisão é 100% humana (parecer estruturado + alçada). O Escopo MVP a marca como obrigatória. A política também define se consultas externas/birô entram agora ou ficam "quando definidas" |
| D2 | **Matriz mínima de permissões** — papel × operação: quem pode criar, editar, aprovar, cancelar, exportar e consultar cada informação | Vicente + Luís | O **permissionamento fino** (obrigatório no MVP). O mecanismo técnico é rápido; a matriz em si é decisão de negócio. Hoje, por decisão provisória, qualquer usuário autenticado acessa quase tudo |
| D3 | **Valores reais das alçadas + regra de exceção** — tetos por produto e a regra "proposta fora do parâmetro sobe para 2ª aprovação" (quais parâmetros, quais limites) | Vicente | A matriz de alçadas existe e funciona, mas os **limites atuais são valores de teste**. Falta a régua oficial |
| D4 | **Regras consolidadas de cobrança, renegociação e quitação** — multa/juros oficiais, condições do acordo (entrada mínima %, nº máximo de parcelas, quando pode), antecipação por natureza do item (planilha em evolução) | Vicente | Tudo roda com padrões provisórios: multa 2% / juros 1% a.m., acordo sem trava de condição, antecipação genérica CR×PS. A **regra do seguro já está decidida** (nunca isenta com cobertura vigente) e pode ser aplicada de imediato, sem esperar o restante |
| D5 | **Fórmulas oficiais dos indicadores mínimos** — inadimplência em % de quê (valor ou contagem? qual janela?), o que conta como "carteira ativa", recebimento por competência ou por caixa | Vicente + Cláudio | O painel de indicadores (Dados/BI, "essencial" no MVP). Os dados já existem no banco; as fórmulas são convenção de negócio |
| D6 | **O que é "histórico básico" do dossiê** — uma lista de eventos por data resolve, ou precisa de timeline visual organizada? | Cláudio + Vicente | Define o tamanho da entrega do dossiê (pode ser 1 dia ou 1 semana de trabalho) |
| D7 | **Cadastro real dos investidores + origem de capital por ativo** — quem é o dono de cada carro da frota. É **dado**, não código (a planilha dos ~65 veículos) | Sebastião + Cláudio | O "vínculo veículo-investidor-cliente-contrato" obrigatório do MVP. A estrutura existe no sistema, mas está vazia |

---

## 2. Placeholders que podem ir à homologação COMO ESTÃO — mediante aceite explícito

Aqui não falta regra nova; falta um **"sim, homologa assim"** registrado, para que o provisório não seja confundido com esquecimento:

1. **Assinatura interna como o "fluxo controlado de assinatura" do MVP** — assinatura titular + Azit em tela, com registro. A integração com plataforma externa (D4Sign etc.) fica pós-MVP. O texto do Escopo MVP admite essa leitura; falta confirmá-la.
2. **Bloqueio remoto como processo manual registrado** — o D+3 manual com auditoria atende; o comando físico ao rastreador é integração futura (fora do MVP, conforme o próprio documento).
3. **Recebível sem breakdown** — a decomposição capital do investidor × remuneração × serviço continua pendente de desenho (Sebastião). Nenhum critério de pronto da seção 7 do Escopo MVP depende dela — mas é preciso registrar o aceite de homologar sem isso.
4. **Capacidade de pagamento humana** — se a política (D1) não sair a tempo, homologa-se com decisão humana estruturada (parecer + alçada + trilha)? É a tensão mais provável do cronograma; melhor decidir antes dela acontecer.
5. **Duas funcionalidades que NÃO existem e o MVP tangencia** — **baixa manual** (pagamento fora do Asaas: TED, dinheiro — acontece na operação real?) e **alteração de vencimento**. Se a operação precisa, constrói-se — as regras de auditoria já estão definidas (responsável + evidência obrigatórios). Se não precisa, registrar formalmente como fora do MVP.

---

## 3. Logística da homologação

| Item | Situação | O que falta |
|---|---|---|
| Segregação de ambientes | Plano pronto (dev local / homolog / produção), aguardando ordem de execução | Autorizar a execução. Homologação usará **Sandbox do Asaas** (decidido em 04/07) e **dados sintéticos** — nunca cópia de produção (LGPD) |
| Usuários-chave | Não definidos | Nomes, papel de acesso de cada um, e quem dá o aceite de cada cenário |
| Roteiro de homologação | Os 9 cenários da seção 8 do Escopo MVP são boa base | Transformar em roteiro formal com critério de aceite por cenário (redação técnica pronta para validação do grupo) |
| Homologação do simulador | Pendente desde a semana passada | Na prática é a **oficialização dos parâmetros**: CI, CR, TR, fatores, entrada mínima, prazos, validade e as ofertas fixas oficiais |
| Contrato oficial | Template fiel ao contrato em uso (17 cláusulas) | Aceite jurídico formal, incluindo os textos nas três periodicidades (semanal, quinzenal, mensal) |

---

## 4. Já decidido — não precisa voltar à mesa

- **Fonte oficial da verdade**: Asaas executa, Azit controla; pagamento confirmado = webhook conciliado no Hub (ADR-007).
- **Nomenclatura**: Azit Hub é a plataforma; Azitmove é a empresa (ADR-014).
- **Eventos auditáveis principais**: implementados em 14/07 — bloqueio/desbloqueio, alteração/remoção de titular, mudanças de alçada, quitação, sinistro, parâmetros — sempre com responsável e antes/depois.
- **Regra do seguro na antecipação**: decidida em 13/07 (nunca isenta com cobertura vigente) — só falta aplicar.
- **Modelagem estrutural**: titular único com papéis derivados e cobrança conta-cêntrica — validados em 13/07.

---

## Resumo executivo

- **7 definições de negócio** (D1–D7), com dono claro para cada uma.
- **5 aceites de placeholder** — decisões de "homologa assim" que evitam surpresa na homologação.
- **5 itens de logística** — ambientes, usuários-chave, roteiro, parâmetros oficiais e contrato.

Do lado técnico, **sem depender de ninguém**, já é possível: aplicar a regra do seguro na antecipação, executar o plano de ambientes (com autorização), redigir o roteiro de homologação e construir o painel de indicadores com fórmulas provisórias marcadas como substituíveis — o padrão que o projeto sempre usou para não parar na ausência de definição.
