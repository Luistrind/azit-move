# Plano de Teste E2E — Azit Hub (julho/2026)

> Valida em tela **tudo que existe**, originando dados novos (sem limpar os atuais), do atendimento à quitação. Cada passo tem resultado esperado — anote ✅/❌ e o gap observado. Jornadas na ordem de dependência: siga a sequência.

## 0. Pré-requisitos

1. Deploy atualizado (backend + migration + frontend) — commits até `434380a`.
2. **3 usuários**: A=ADMIN/OPERADOR (operador do dia a dia), B=APROVADOR, C=DIRETOR — necessários para segregação (quem pede não decide).
3. Ambiente com endpoints de dev habilitados (para "simular pagamento") **ou** disposição de pagar boletos no Asaas como nos testes anteriores.
4. Tenha em mãos: um CPF de teste para o comprador, um segundo para o 2º comprador, um terceiro para o garantidor.

## J1 — Cadastros base (Ativos e parâmetros)

| # | Passo | Esperado |
|---|---|---|
| 1.1 | Cadastrar veículo novo com **km "35.000"** e valores com milhar BR ("48.500") | Aceita ponto de milhar; ao reabrir para edição, valores formatados pt-BR |
| 1.2 | Definir origem de capital do ativo (valor aportado, taxa com vírgula "2,5") | Salva; taxa aceita vírgula |
| 1.3 | Anexar documento do veículo (CRLV) e baixar | Upload/download ok, arquivo no cadastro |
| 1.4 | Vincular o ativo a uma **oferta fixa** (Configurações → Simulador) | Ativo aparece com a oferta na vitrine |
| 1.5 | Configurações → Simulador: conferir parâmetros vigentes (CI, CR, TR, fatores 4/2 e 4,345/2,1725, desconto antecipação CR 20%) | Valores corretos; criar nova versão gera histórico (não altera simulações antigas) |

## J2 — Originação (Atendimento → Simulação → Proposta)

| # | Passo | Esperado |
|---|---|---|
| 2.1 | Novo atendimento: nome, CPF, **telefone e canal** (ex.: OLX); CEP no cadastro preenche endereço | Lead criado; CEP busca automática |
| 2.2 | Simular com o ativo da J1: ver oferta fixa em destaque + 3 padrão + personalizada | Cards sem nº de parcelas (decisão 11/07); valores da parcela = PF (÷4 semanal) |
| 2.3 | Simular opção personalizada (entrada, prazo, frequência) | Bloqueios de entrada mínima/prazo respeitados |
| 2.4 | "Apresentar ao cliente" e depois selecionar oferta | Estados mudam; validade 7 dias visível |
| 2.5 | Sair, voltar pela listagem de simulações e **retomar** | Retomada abre com cliente e oferta |
| 2.6 | Converter em proposta; adicionar produto (seguro) no carrinho | Proposta criada com item apartado |
| 2.7 | Anexar documentos obrigatórios do comprador (CNH, extratos...) | Pendências calculadas; gate para análise |

## J3 — Análise de Cadastro (Política v1.0) — NÚCLEO NOVO

| # | Passo | Esperado |
|---|---|---|
| 3.1 | Na proposta, passo Análise → botão "Análise de Cadastro (Política v1.0)" | Abre workspace `/analises/:id`, status CADASTRO EM PREENCHIMENTO |
| 3.2 | Tentar registrar consulta ANTES da autorização | **Bloqueado** com mensagem (RF-05) |
| 3.3 | Registrar autorização WhatsApp do comprador | Aparece na trilha com texto/versão |
| 3.4 | Preencher 3 rendas (declarada 6.000, presumida 5.500, apurada 6.000); salvar | Salva; campos independentes |
| 3.5 | Alterar renda apurada SEM justificativa | **Bloqueado** (justificativa obrigatória) |
| 3.6 | Marcar identidade validada, CNH válida, atividade comprovada; definir **condutor principal** | Condutor só habilita com CNH válida |
| 3.7 | Registrar consultas: Camada 1 → Score Quod (630) → Restritivos (não financeiro 487) | Status avança automático; critério restritivo 487 NÃO aparece (dentro da tolerância) |
| 3.8 | Painel de critérios | "TODOS CONFORMES"; comprometimento exibido (≤40%) |
| 3.9 | Emitir parecer → **Aprovar (alçada do analista)** | Aprovado; pacote mínimo quase todo ✓ |
| 3.10 | **Liberar para formalização** | Status LIBERADO; proposta vira APROVADA |

## J4 — Análise: caminho COCAD (segunda proposta, dados novos)

| # | Passo | Esperado |
|---|---|---|
| 4.1 | Originar 2ª proposta (outro CPF); análise com renda apurada BAIXA (comprometimento >40%) OU score 580 | Critério vermelho COC-01/COC-02; botão de aprovar desabilitado |
| 4.2 | Registrar uma consulta como **FALHA** (ex.: Boa Vista indisponível) | COC-11; alçada mínima COCAD; fluxo não trava |
| 4.3 | Emitir parecer → **Submeter ao COCAD** (usuário A) | Vai para AGUARDANDO COCAD; aparece na Central de Aprovações |
| 4.4 | Usuário A tenta decidir a própria submissão | **Bloqueado** (segregação) |
| 4.5 | Usuário B (Aprovador) aprova na Central | Status APROVADO PELO COCAD |
| 4.6 | Alternativa (3ª proposta): COCAD **aprova com ressalva** (aumento de entrada) | Ressalva criada; formalização bloqueada até validar; validar → volta a aprovado |
| 4.7 | Testar **Não aprovar** (NAP-06 + justificativa) numa proposta descartável | NAO_APROVADO; proposta REPROVADA |
| 4.8 | Testar **Encerrar por desistência** em outra | PROPOSTA_ENCERRADA ≠ não aprovação |
| 4.9 | Tentar formalizar proposta com análise NÃO liberada | **Bloqueado** pelo gate |

## J5 — Formalização, assinatura e ativação (dia zero)

| # | Passo | Esperado |
|---|---|---|
| 5.1 | Formalizar a proposta da J3: definir **data da 1ª parcela** (default próxima segunda) | Contrato "Aguardando assinatura", SEM cronograma |
| 5.2 | Ver documento do contrato | 17 cláusulas do contrato oficial, dados preenchidos (valores por extenso, taxas) |
| 5.3 | Assinar titular + Azit; **Ativar** (cobra entrada) | Cobrança da entrada gerada (Asaas) |
| 5.4 | Pagar/simular pagamento da entrada | **Dia zero**: cronograma completo nasce (parcelas + recebíveis + faturas); contrato ATIVO |
| 5.5 | Conferir fatura da conta | Parcelas do veículo E do seguro na MESMA fatura (conta-cêntrico) |

## J6 — Cobrança e régua

| # | Passo | Esperado |
|---|---|---|
| 6.1 | Rodar fechamento (D-5) e ver cobrança no Asaas | Fatura emitida com multa 2%/juros 1% |
| 6.2 | Pagar uma fatura (real ou simulada) | Baixa automática via webhook; parcelas PAGAS; imputação encargo→serviço→principal |
| 6.3 | Deixar/forçar uma fatura vencida e rodar a régua | Kanban da régua mostra D+1/D+2 |
| 6.4 | Tentar bloquear contrato antes de D+3 | **Bloqueado** ("só a partir de D+3") |
| 6.5 | Bloquear em D+3 e depois desbloquear | Funciona; **auditoria registra responsável** nas duas ações |

## J7 — Crédito de manutenção (cliente ativo)

| # | Passo | Esperado |
|---|---|---|
| 7.1 | Na ficha do titular, contratar crédito de manutenção (valor livre) | Vai para aprovação por alçada |
| 7.2 | Aprovar com usuário B | Contrato de crédito criado |
| 7.3 | Conferir fatura | Parcelas do crédito CONSOLIDADAS na próxima fatura aberta da conta (não fatura separada) |
| 7.4 | Centro de custo do ativo | Gasto × recebido por veículo + visão crédito avulso |

## J8 — Renegociação conta-cêntrica (Acordo)

| # | Passo | Esperado |
|---|---|---|
| 8.1 | Com parcelas em atraso, abrir wizard de renegociação na ficha | Diagnóstico soma atraso de TODOS os contratos da conta |
| 8.2 | Estruturar acordo (entrada + parcelas novas) e enviar | Vai ao motor de aprovação |
| 8.3 | Aprovar (usuário B) e pagar/simular a entrada | Acordo ATIVO; parcelas cobertas com vínculo de acordo (não some nada) |

## J9 — Quitação e antecipação (fórmula do Vicente)

| # | Passo | Esperado |
|---|---|---|
| 9.1 | No contrato ativo, simular antecipação de parcelas específicas ("as próximas 4") | VP por parcela = CR a 20% a.m. + PS na TR; distantes descontam mais |
| 9.2 | Simular quitação total | Soma dos VPs; comparar ordem de grandeza com a planilha do Vicente |
| 9.3 | Quitar | PAGA_ANTECIPADA; recebíveis REALIZADOS; contrato QUITADO_AGUARDANDO_TRANSFERENCIA se zerou; auditoria com responsável |
| 9.4 | **GAP CONHECIDO a confirmar**: contrato de seguro apartado ainda desconta genérico (regra "seguro nunca isenta" pendente de implementação) | Anotar comportamento |

## J10 — Operações especiais

| # | Passo | Esperado |
|---|---|---|
| 10.1 | Sinistro com indenização parcial (prompt aceita "20.000") | Amortiza parcelas inteiras; dívida restante permanece (Regra 3) |
| 10.2 | Reajuste IPCA ("4,5") → aprovar no motor | Parcelas futuras reajustadas após aprovação |
| 10.3 | Novação de um contrato | Liquida (LIQUIDADO_POR_NOVACAO) e cria novo, com 2 aprovações |

## J11 — Governança e transversais

| # | Passo | Esperado |
|---|---|---|
| 11.1 | Editar matriz de alçadas / criar operação | Salva; **auditoria com responsável e antes/depois** |
| 11.2 | Editar dados do titular | Auditoria registra antes/depois |
| 11.3 | Mudar parâmetro do simulador → conferir simulação/contrato antigos | NADA recalcula (snapshot congelado) |
| 11.4 | Acessar tudo pelo **celular** | Sidebar em gaveta, tabelas roláveis, sem quebra |
| 11.5 | Atendimento com usuário B (não-operador) | Consegue abrir atendimento (liberado para todos) |

## Registro de gaps

Para cada ❌: anotar jornada/passo, o que esperava, o que aconteceu (print se possível) e gravidade (trava / incômodo / cosmético). Esse registro vira a lista de correções da homologação — e alimenta os critérios da seção 7 do Escopo MVP.

**Gaps já conhecidos (não perder tempo "descobrindo")**: antecipação por natureza do item no seguro (aguarda regra R1 completa); breakdown do recebível (Sebastião); permissionamento fino; timeline do cliente; indicadores mínimos; Azit Score (fora do escopo por decisão); integrações de consulta reais (Fase 2); prompts simples em NAP/ressalvas/encerramento (refinar UI).
