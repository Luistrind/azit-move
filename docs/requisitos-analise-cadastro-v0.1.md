# Documento de Requisitos — Análise de Cadastro no Azit Hub

## 1. Escopo e faseamento

**Escopo**: análise de cadastro de propostas de venda parcelada (1 ou 2 compradores + garantidor quando exigido), do atendimento à liberação para formalização ou encerramento. Fora de escopo (conforme Política §3): regras comerciais do simulador, contrato, ativação, cobrança, renegociação, recuperação e quitação.

**Fase 1 — fluxo completo com consultas manuais** (a conta BigDataCorp ainda não existe). Toda a máquina de estados, cadastro estendido, documentos, renda comprovada, motor de regras, COCAD, ressalvas, pendências, códigos, parecer, pacote mínimo e auditoria. Resultados de consulta (Camada 1, Quod, Boa Vista) são **registrados manualmente pelo analista** com data/protocolo — placeholder funcional isolado, substituível.

**Fase 2 — integrações automáticas.** Adaptadores BigDataCorp/Quod/Boa Vista (quando a conta existir), Azit Score calculado automaticamente, SLAs medidos, indicadores completos.

---

## 2. Requisitos funcionais

Formato: **ID · Origem** (seção dos documentos) · Descrição · Regras principais · Critérios de aceite. Atores conforme RACI do Processo §4. Todo requisito grava auditoria conforme RF-23.

### Grupo A — Proposta e participantes

**RF-01 — Proposta de análise com participantes por papel**
*Origem: Política §3, §12; Contexto §8.1 ("implicação de modelagem"); Processo §7.1.*
A proposta de análise vincula 1 comprador principal, opcionalmente 1 segundo comprador e, quando exigido, 1 garantidor — como **participações com papel próprio** (entidade, não colunas fixas). Cada participante tem cadastro, documentos, autorização, consultas e análise individuais.
Regras: segundo comprador e garantidor são papéis distintos com efeitos distintos (garantidor é mitigador — Contexto §8.2); qualquer critério fora da alçada em qualquer participante impede aprovação direta da proposta inteira (Política §12).
Aceite: (a) criar proposta com 2 compradores exige cadastro completo dos dois antes da análise conjunta; (b) restritivo no 2º comprador leva a proposta ao COCAD; (c) garantidor não pode ser cadastrado como segundo comprador.

**RF-02 — Cadastro estendido por comprador**
*Origem: Política §9; Processo §7.3.*
Dados mínimos por participante: nome, CPF, nascimento, RG quando aplicável, estado civil, WhatsApp (confirmado), telefone secundário, e-mail, profissão/atividade, tipo e tempo de atividade, MEI/CNPJ quando aplicável, plataforma/empresa, endereço completo, **renda mensal declarada** + fonte + periodicidade, e identificação do papel.
Aceite: (a) proposta não avança para documentos sem os obrigatórios preenchidos por comprador; (b) alteração de campo grava valor anterior, novo, responsável e justificativa.

**RF-03 — Vínculo e versionamento da oferta**
*Origem: Processo §7.2; Contexto §6 (etapa 2) e cenário 10.*
A análise vincula-se à oferta escolhida (veículo, entrada, prazo, frequência, parcela, produtos, validade — já existente no simulador). **Toda alteração de oferta gera nova versão e obriga reanálise** dos critérios afetados (comprometimento, alçada), preservando histórico.
Aceite: alterar a oferta de uma proposta aprovada retorna a proposta para reavaliação de alçada e invalida a liberação anterior.

### Grupo B — Documentos e autorização

**RF-04 — Tipos documentais da análise**
*Origem: Política §10; Processo §7.4.*
Novos tipos por participante: CNH; **documento de identidade alternativo (RG) na ausência de CNH** *(ajuste proposto à Política §10 — a validar nesta revisão)*; comprovante de renda; comprovante de atividade; extrato bancário (últimos 3 meses); extrato de aplicativo; MEI/CNPJ; documento complementar. Comprovante de endereço deixa de ser obrigatório (Política §13.2 — divergência confirmada pelo atendente pode seguir).
Regras: documento ilegível/vencido/incompleto gera pendência (COM-02/03), nunca resultado desfavorável; substituição preserva o arquivo anterior (supersessão com motivo e responsável).
Aceite: (a) checklist de mínimos por participante calculado automaticamente; (b) substituir documento não apaga o original; (c) documento vencido é sinalizado.

**RF-05 — Autorização de consulta (gate)**
*Origem: Política §9, §13.1, §28; Processo §7.4/7.5.*
Nenhuma consulta externa (manual ou automática) pode ser registrada/executada sem autorização de consulta registrada para o participante. *[PENDENTE — formato a definir (aceite registrado ou termo assinado via ZapSign); provisório: registro de aceite com responsável, data/hora e texto vigente da autorização.]*
Aceite: tentativa de registrar consulta sem autorização é bloqueada com mensagem clara; o registro da autorização aparece na trilha de auditoria.

**RF-06 — Validade documental e de consultas**
*Origem: Política §31; Contexto §12.3, §18.*
Validades parametrizadas: consultas 30 dias corridos; aprovação direta 10 dias úteis; extratos: janela de 3 meses. Consulta vencida bloqueia o pacote mínimo e exige reanálise da etapa afetada (não do fluxo inteiro).
Aceite: proposta com consulta vencida não pode ser liberada para formalização; reanálise recalcula apenas o critério afetado preservando histórico.

### Grupo C — Renda e cálculos

**RF-07 — Evidências de renda/atividade como entidade**
*Origem: Política §11; Contexto §7.4, §15.2.*
Cada evidência registra: participante, fonte/tipo (extrato bancário, extrato de app, comprovante, MEI...), período, valor, **incluída ou excluída** da média (com motivo: transferência própria, empréstimo, atípico, sem origem) e responsável.
Aceite: a renda média ajustada é reconstruível a partir das evidências e exclusões registradas.

**RF-08 — Renda comprovada**
*Origem: Política §11.1/11.2; Contexto §7.4.*
Renda comprovada por participante = **menor valor** entre renda declarada e média mensal ajustada. Renda presumida de birô **nunca** alimenta o campo (antirrequisito). Renda conjunta: só soma rendas comprovadas de participantes formalmente vinculados; renda parcialmente comprovada → complemento ou COCAD (COC-08).
Aceite: (a) campo de renda comprovada é calculado, não digitável livremente; (b) tentativa de somar renda de participante sem vínculo formal é bloqueada; (c) declarada R$ 8.000 + média ajustada R$ 5.000 → comprovada R$ 5.000.

**RF-09 — Parcela mensal equivalente e comprometimento**
*Origem: Política §14; Contexto §7.5/7.6.*
Parcela mensal equivalente = parcela × fator (semanal **4,345**; quinzenal **2,17**; mensal 1 — conforme o documento do Vicente), parâmetro versionado, **sem alterar o cronograma comercial**. Comprometimento = parcela mensal equivalente ÷ renda comprovada total × 100.
Aceite: (a) parcela semanal de R$ 942 → equivalente mensal R$ 4.092,99; (b) o cronograma do contrato não muda; (c) a versão do fator usada fica gravada no cálculo.

### Grupo D — Consultas externas

**RF-10 — Consultas escalonadas com falha segura**
*Origem: Política §5, §13.5/13.6; Processo §7.5/7.7/7.8; Contexto §6.1, §12.1.*
Ordem fixa: Camada 1 (BigDataCorp) → Score Quod → Boa Vista/restritivos. Cada consulta registra: participante, fornecedor, produto, protocolo, data, custo, resultado normalizado (conceitos internos, não formato do fornecedor) e validade. **Falha ou ausência de consulta obrigatória bloqueia aprovação direta e liberação — nunca assumir resultado favorável.**
Fase 1: registro manual do resultado pelo analista (com protocolo/data). Fase 2: adaptadores automáticos com retry idempotente e visão de estado da integração.
Regras de armazenamento: score (valor, faixa, data); restritivos estruturados (natureza financeiro/não financeiro, valor, status ativo/baixado, titularidade) — nunca booleano "tem restrição"; processos estruturados (tipo, polo, status, valor, relevância).
Aceite: (a) proposta sem Score Quod registrado não permite aprovação direta; (b) restritivos somam por natureza e por proposta; (c) trocar de fornecedor não exige mudança no domínio.

### Grupo E — Motor de regras, score e códigos

**RF-11 — Motor de regras da análise**
*Origem: Política §13 (critérios 13.1–13.9), §15, §16; Contexto §15.3.*
Para cada critério (identidade, CNH, autorização, WhatsApp/endereço, atividade, renda, comprometimento, Score Quod, restritivos, processos, fraude, divergências), o motor produz saída estruturada: situação (dentro da alçada / complemento / COCAD), valor observado, regra aplicada, código de motivo, bloqueio e versão do parâmetro. Consolidado: aprovação direta permitida só com **todos** os critérios conformes (cumulativo — Política §15). **O motor nunca produz "não aprovado"** — apenas bloqueia e encaminha (antirrequisito nº 1).
Aceite: (a) comprometimento 44,8% → saída "fora da alçada, COCAD, COC-01, bloqueio de aprovação direta" (exemplo literal do Contexto §15.3); (b) todos conformes → botão de aprovação habilitado só para o analista; (c) não existe nenhum caminho de reprovação automática no código.

**RF-12 — Azit Score**
*Origem: Política §22; Contexto §9.1/9.2.*
Pontuação interna por subcritérios (pesos 15/15/20/20/20/10, parametrizados e versionados), faixas 85–100 / 70–84 / <70 com encaminhamento sugerido. **Nunca decide sozinho e nunca compensa critério obrigatório de subida** — bloqueios prevalecem sobre a soma. Fase 1: calculado a partir dos dados registrados (mesmo manuais); subcritérios sempre visíveis, não só o total.
Aceite: proposta com Azit Score 90 e restritivo financeiro ativo sobe ao COCAD mesmo assim.

**RF-13 — Códigos de motivo**
*Origem: Política §23, Anexo VI.*
Catálogo versionado: APR-01..09, COC-01..11, COM-01..10, NAP-01..10. Toda decisão/encaminhamento registra um motivo principal e opcionalmente adicionais, vinculados a participante/critério. Catálogo editável por configuração (novos códigos), nunca hard-coded.
Aceite: relatório de subidas ao COCAD agrupado por código funciona sem parsing de texto livre.

### Grupo F — Estados e fluxo

**RF-14 — Máquina de estados da análise**
*Origem: Política §25; Processo §6; Contexto §10.1.*
Os 19 status oficiais (Atendimento iniciado → ... → Liberado para formalização / Não aprovado / Proposta encerrada), **um único status ativo** por proposta, transições com pré-condições explícitas e histórico completo (status anterior, novo, responsável, data/hora, motivo). Status não armazena informação de negócio — pendências, ressalvas, alertas e consultas são entidades relacionadas.
Aceite: (a) transição inválida é rejeitada (ex.: "Liberado para formalização" sem pacote mínimo); (b) o histórico de transições reconstrói a jornada completa; (c) os nomes dos status são exatamente os oficiais da Política §25.

**RF-15 — Pendência / complemento**
*Origem: Política §17; Processo §8; Contexto §3.2, §8.3.*
Pendência é entidade: código COM, participante, descrição específica ("qual documento, de qual pessoa, para qual finalidade, até quando"), prazo (padrão 3 dias úteis, parametrizado), status. Cumprida → proposta **retorna à etapa que originou** a pendência (não ao início). Não cumprida → encerramento operacional por ausência de retorno (decisão humana). **Complemento (falta informação) ≠ COCAD (risco conhecido)** — status, códigos e métricas separados.
Aceite: (a) pedido de complemento sem especificar documento/participante é rejeitado; (b) complemento cumprido reabre na etapa de origem com a análise anterior preservada.

### Grupo G — Decisão

**RF-16 — Aprovação na alçada do analista**
*Origem: Política §15; Anexo II.*
Habilitada apenas quando todos os critérios estão conformes: CPF regular sem óbito, dados compatíveis, CNH válida (ou alternativa D-A), autorização registrada, atividade comprovada, renda comprovada, comprometimento ≤ 40%, Score Quod ≥ 600, sem restritivo financeiro ativo, não financeiro ≤ R$ 500 somado, sem processo relevante, sem indício de fraude, sem pendência aberta. Aprovação vale 10 dias úteis (RF-06). Atendente **nunca** aprova (segregação — antirrequisito).
Aceite: (a) usuário com papel de atendente não vê/não executa a ação de aprovar; (b) qualquer critério fora → ação desabilitada com motivo visível.

**RF-17 — COCAD sobre o motor de aprovação existente**
*Origem: Política §16, §18, §19; Processo §8; Contexto §8.4.*
Subida automática nos critérios da Política §16 (COC-01..11). A submissão leva o dossiê + parecer do analista (= primeiro voto/recomendação). O segundo membro *[PENDENTE — composição a definir; provisório: papéis Aprovador/Diretor, configurável na matriz de alçadas]* registra a decisão: **aprovar / aprovar com ressalvas / solicitar complemento / não aprovar**. Implementação: instância do motor de aprovação unificado já existente (trilha, segregação solicitante≠decisor, N aprovações configurável).
Aceite: (a) proposta com Score 580 sobe automaticamente com COC-02; (b) o analista que submeteu não pode ser o decisor; (c) decisão registra voto, responsável, data/hora, condições.

**RF-18 — Parecer estruturado obrigatório**
*Origem: Política §24, Anexo VII; Contexto §9.4.*
Quatro tipos (aprovação, subida, complemento, não aprovação) com conteúdo mínimo conforme os modelos do Anexo VII — os campos numéricos (renda comprovada, parcela equivalente, comprometimento, score) vêm **do sistema**, não digitados no texto. IA pode auxiliar a redação futuramente, mas nunca inventa evidência (Contexto §9.4) — fora desta fase.
Aceite: parecer de aprovação sem renda comprovada ou comprometimento preenchidos pelo sistema não pode ser emitido.

**RF-19 — Ressalvas como entidade**
*Origem: Política §20; Contexto §8.5.*
Tipos: aumento de entrada, redução da proposta, inclusão de garantidor, documento adicional, ajuste de condição. Cada ressalva: condição objetiva, prazo (5 dias úteis padrão; decisão vale 7 dias corridos ou validade da oferta — parametrizado), evidência de cumprimento, validação, status. **Aprovado com ressalva ≠ liberado**: estado intermediário "Ressalva em tratamento" bloqueia formalização até validação. Expirada → retorna ao COCAD ou encerra (decisão humana, nunca vira "não aprovado" automático).
Aceite: (a) ressalva de aumento de entrada recalcula comprometimento e exige comprovante; (b) formalização bloqueada com ressalva pendente; (c) expiração não gera não-aprovação automática.

**RF-20 — Protocolo de fraude por níveis**
*Origem: Política §13.8; Contexto §7.10.*
Níveis: dúvida documental (complemento + bloqueio de aprovação), indício relevante (bloqueio de formalização + COCAD + alerta), indício confirmado (não aprovação humana + preservação de evidências), alerta resolvido (retoma alçada). Evidências preservadas (arquivos não são apagados nem substituídos silenciosamente).
Aceite: alerta de fraude relevante bloqueia formalização mesmo com todos os demais critérios conformes.

**RF-21 — Não aprovação humana e encerramentos classificados**
*Origem: Política §18; Contexto §12.4.*
Não aprovação: sempre humana, fundamentada, com código NAP e responsável. Encerramentos distintos: **não aprovação cadastral ≠ desistência ≠ ausência de retorno ≠ expiração** — motivos finais separados para não distorcer indicadores.
Aceite: desistência do cliente não aparece nos indicadores de não aprovação.

### Grupo H — Integração, auditoria e governança

**RF-22 — Pacote mínimo para formalização**
*Origem: Política §26; Contexto §13.*
Checklist bloqueante da transição para Contratos e Ativação: decisão válida (não vencida), parecer + códigos, documentos classificados, consultas válidas, renda e cálculos, sem pendência, ressalvas cumpridas, garantidor aceito quando exigido, versão da política, responsável. A integração transmite **dados e identificadores** (status, participantes, condições), não apenas documento.
Aceite: cada item faltante do pacote é apontado nominalmente ao tentar liberar.

**RF-23 — Auditoria por etapa com versão da política**
*Origem: Política §27; Processo §13; Contexto §10.5.*
Eventos mínimos por objeto (proposta, oferta, cadastro, documentos, consultas, renda, decisão, ressalva, fraude, formalização, encerramento) com responsável, data/hora, antes/depois e **versão da política aplicada**. Correção nunca sobrescreve: gera versão/evento com justificativa. Base: LogAuditoria existente, estendido.
Aceite: auditoria reconstrói integralmente por que uma proposta foi aprovada, com qual regra, por quem e com que evidências.

**RF-24 — Parâmetros da análise versionados**
*Origem: Política §31; Contexto §4.3, §18.*
Central de parâmetros da análise (mesma mecânica da `VersaoParametrosSimulacao`): comprometimento 40% / faixa 40,01–50%, Score Quod 600, restritivo não financeiro R$ 500, pesos e faixas do Azit Score, fatores 4,345/2,17/1, validades (30d/10du), prazos (complemento 3du, ressalvas 5du/7dc), SLAs, catálogo de códigos. Nova configuração = nova versão; proposta grava a versão aplicada. *(Sem propostas reais no sistema: a Política v1.0 vale para todas as propostas novas, sem regra de transição.)*
Aceite: mudar o limite de comprometimento não altera o encaminhamento de propostas já analisadas.

**RF-25 — SLAs e indicadores operacionais**
*Origem: Política §30; Processo §9, §14; Contexto §12.2, §14.*
Medição de tempo por estado (separando tempo interno × aguardando cliente) contra os SLAs sugeridos (parametrizados). Indicadores dos 4 grupos da Política §30 (operacionais, decisão, carteira, política). Fase 1: medição e fila; Fase 2: painel completo.
Aceite: fila do analista e do COCAD ordenáveis por tempo no estado, com atraso sinalizado.

**RF-26 — Comunicação com o cliente**
*Origem: Política §29.*
Textos padrão por situação (complemento, ressalva, não aprovação, divergência) sem expor score, regra interna ou detalhe de birô. O sistema oferece o texto; o envio é do atendimento (WhatsApp).
Aceite: a tela de não aprovação para o atendente não exibe fórmulas/valores internos de birô para copiar.

**RF-27 — Permissões por papel da análise**
*Origem: Política §7, §28; Processo §3/§4 (RACI); Contexto §11.2.*
Papéis: Atendente (coleta, anexos, pendências, comunicação — não decide), Analista (triagem, renda, parecer, aprovação na alçada), COCAD (decisões superiores), Administração (parâmetros). Acesso a dados por necessidade (mínimo privilégio): atendente não vê detalhe de birô além do necessário. Primeiro caso de uso real do permissionamento fino (item do MVP).
Aceite: cada ação do RACI é executável apenas pelos papéis marcados R/A.

---

## 3. Requisitos não funcionais específicos

*Origem: Contexto §15.4, §11.5; complementam o docs/rnf.md geral.*

- **Falha segura**: ausência/falha de consulta obrigatória nunca é interpretada como favorável.
- **Idempotência**: reprocessamento de consulta não duplica custo nem registro (chave de idempotência por protocolo).
- **LGPD**: logs sem CPF/documentos/respostas integrais de birô; acesso por papel; dados sintéticos em teste; registro de acesso a documentos sensíveis.
- **Parametrização**: nenhum limite de negócio hard-coded (todos via RF-24).
- **Testabilidade**: regras testáveis por versão; cenários 1–12 do Contexto §17 como suíte de aceitação obrigatória.
- **Integridade transacional** em cálculos, decisões e transições.

## 4. Modelo de dados — o que nasce e o que se estende

| Entidade (Contexto §15.2) | Situação no Azit Hub |
|---|---|
| Proposta, Pessoa, Participação, Oferta/versão, Documento, Parecer, Decisão/Voto (motor de aprovação), Evento de auditoria, Versão de parâmetros | **Existem** — estender (campos da análise, tipos documentais, versão da política) |
| Evidência de renda/atividade, Consulta externa, Critério avaliado, Cálculo, Pendência, Ressalva, Alerta de fraude | **Novas** — criar conforme RF-07/10/11/15/19/20 |

## 5. Critérios de aceitação da entrega (visão Vicente)

1. Os 12 cenários exemplificativos do Contexto §17 passam de ponta a ponta no sistema (Fase 1, com consultas manuais).
2. Nenhum caminho de reprovação automática existe.
3. Todos os parâmetros da tabela do Contexto §18 são configuráveis sem código.
4. A auditoria reconstrói qualquer decisão com versão da política.
5. Os 16 antirrequisitos do Contexto §16 são verificáveis (checklist de revisão antes do deploy).

## 6. Rastreabilidade

Cada RF referencia as seções de origem. Inversamente: Política §§9–31 → RF-01..27 (cobertura completa); Processo §§6–14 → RF-14/15/22/23/25/26; Contexto §16 (antirrequisitos) → restrições incorporadas nos RFs correspondentes. Itens da Política sem requisito próprio por já existirem no Azit Hub: simulador/oferta (§ Documentos relacionados), motor de aprovação (base do RF-17), gestão documental básica (base do RF-04).
