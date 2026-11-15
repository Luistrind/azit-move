# Doc 6 — Autenticação e Permissões
## Azit Move V3

**Versão:** 1.1  
**Data:** jun/2025 · revisão nov/2026  
**Status:** Aprovado para implementação (V1: autenticação interna; titular: desenhada, implementação futura)

> **Revisão 1.1 (decisões Luís, 12/11/2026):** (a) entrada do usuário interno passa a ser pela **conta Google do Workspace** (domínios `azit.com.br` e `azitmove.com.br`, mesmas caixas), senha vira reserva **desligada por padrão** e liberada por usuário pelo Admin (§2); (b) a **área de trabalho** (doc 02 §16) passa a ser **autorização de verdade**, checada na API e nas rotas da tela, não só no menu (§5.4, §7.5); (c) **alertas por e-mail** sobre as notificações dirigidas a um usuário: aprovação esperando por ele e retorno das solicitações dele (§12); (d) limite de tentativas, bloqueio temporário e **registro de acessos** (§2.5, §11.3). As seções alteradas trazem a marca *(v1.1)*.

---

## Sumário

1. Visão geral — dois mundos de identidade
2. Autenticação do Usuário interno *(v1.1: Google + senha opcional)*
3. Estratégia de tokens
4. Payload do JWT
5. Roles e RBAC *(v1.1: §5.4 áreas de trabalho)*
6. Alçadas de aprovação
7. Guards e proteção de rotas *(v1.1: §7.5 AreaGuard)*
8. Autenticação do Titular (desenho — implementação futura)
9. Modelos de dados *(v1.1)*
10. Fluxos de autenticação *(v1.1)*
11. Notas de implementação e segurança *(v1.1)*
12. Alertas por e-mail *(v1.1)*
13. Mapa módulo → área *(v1.1)*

---

## 1. Visão geral — dois mundos de identidade

O sistema tem **dois mecanismos de identidade distintos**, cada um único no seu mundo. Não se misturam e não compartilham credenciais.

| Mundo | Quem | Como autentica | Acessa |
|---|---|---|---|
| **Interno** | Funcionário (Usuario) | conta Google do Workspace (`azit.com.br` / `azitmove.com.br`); senha só se o Admin liberar *(v1.1)* | Console operacional |
| **Externo** | Pessoa (Titular) | identidade própria (futura) | A própria conta |

**Usuario interno** acessa o console operacional. Tem múltiplos roles que se somam (RBAC). É o foco da implementação do V1.

**Titular externo** autentica uma vez e acessa **a própria conta**. Dentro da conta, vê os módulos correspondentes ao que possui — módulo cliente se tem ContratoCredito, módulo investidor se tem ContratoInvestimento, ambos se tem os dois. Não são logins separados: é um login, uma conta, módulos condicionais. A estrutura é desenhada desde já (seção 8), mas a implementação é fase futura, junto com as telas desses módulos (marcadas como fora do V1 no Doc 3).

> **Princípio:** o titular não tem "tipo de login". O que ele vê é derivado do que a conta possui, nunca de uma classificação do acesso. Espelha o app do banco: você entra uma vez e vê crédito e investimentos como abas da mesma conta.

---

## 2. Autenticação do Usuário interno

O Usuario representa um funcionário da Azit (operação, financeiro, direção). Desde a v1.1 autentica com a **conta Google do Workspace da empresa**; a senha própria do sistema existe só como reserva, desligada por padrão.

> **Por quê (decisão Luís, 12/11/2026).** Toda a equipe tem conta no Workspace e ninguém de fora do domínio usa o sistema. Entrando pelo Google, senha, segundo fator, bloqueio de conta e desligamento de funcionário passam a ser administrados num lugar só: desativou a conta Google, o acesso ao Hub morre junto. Manter um segundo esquema de senha e segundo fator dentro do sistema duplicaria o trabalho sem ganho. O que continua nosso: quem existe no Hub, quais áreas vê, limite de tentativas e registro de acessos.

### 2.1 Identidade

- **Identificador:** e-mail do Workspace, único no sistema.
- **Dois domínios, mesmas caixas:** `azit.com.br` e `azitmove.com.br` são a mesma conta Google (domínio e alias). O vínculo entre a conta Google e o Usuario é pela **parte local do e-mail**, aceitando qualquer um dos dois domínios: `joao@azit.com.br` e `joao@azitmove.com.br` são o mesmo usuário. O e-mail gravado no cadastro é o que o Admin digitou; a comparação normaliza (minúsculas, domínio em `DOMINIOS_WORKSPACE`, constante única em `packages/utils`).
- **Vínculo estável:** no primeiro acesso pelo Google o sistema grava o `sub` do Google (`googleSub`, identificador imutável da conta). Dali em diante o acesso exige e-mail **e** `sub` iguais. Se uma conta Google for apagada e o mesmo e-mail recriado no Workspace, o `sub` muda e o acesso é negado até o Admin "religar" o vínculo em Usuários e permissões (ação auditada). Isso impede que um e-mail reaproveitado herde o acesso do dono anterior.
- **Nenhuma conta nasce no login.** Conta Google válida do domínio que não corresponde a um Usuario ativo recebe a mesma resposta genérica de falha. Criar usuário continua sendo ação do Admin.

### 2.2 Entrar com Google

Fluxo com o botão oficial do Google (Google Identity Services) e **ID token** verificado no backend. Não usamos o fluxo de autorização com escopos: o sistema não lê nada da conta do usuário, só confirma quem ele é.

1. Tela de login mostra o botão "Entrar com Google". O usuário escolhe a conta do Workspace.
2. O Google devolve ao navegador um ID token (JWT assinado pelo Google).
3. O navegador envia o token para `POST /api/v1/auth/google` (rota pública).
4. O backend valida o token com a biblioteca oficial do Google: assinatura, `aud` igual ao nosso client id, `iss` do Google, `exp`, `email_verified = true`.
5. Confere o domínio: o claim `hd` **e** o domínio do e-mail precisam estar em `DOMINIOS_WORKSPACE`. Conta pessoal `@gmail.com` ou de outro Workspace é recusada.
6. Localiza o Usuario pela parte local do e-mail, ativo e não excluído. Confere ou grava o `googleSub` (§2.1).
7. Emite **os mesmos** access token e refresh token da §3. O resto do sistema não sabe por onde o usuário entrou.
8. Registra o acesso (§2.5). Falha em qualquer passo: `401` genérico e registro do motivo só no log de acessos, nunca na resposta.

Configuração: `GOOGLE_CLIENT_ID` no backend e no frontend (o id do cliente OAuth é público por natureza; não há client secret neste fluxo). O cliente OAuth é criado no Google Cloud da empresa, tipo "aplicativo Web", com as origens autorizadas de homolog e produção. Sem `GOOGLE_CLIENT_ID` configurado o botão não aparece e o sistema avisa na tela de Integrações.

### 2.3 Senha como reserva (desligada por padrão)

- Cada Usuario tem `permiteSenha` (padrão `false`). **Só o Admin** liga ou desliga, em Usuários e permissões, e a mudança é auditada com motivo.
- Com `permiteSenha = false`, `POST /auth/login` responde o mesmo `401` genérico de credencial inválida, sem dizer que a senha está desligada.
- Para que serve: pane do Workspace, conta de serviço de teste em homolog, ou um caso excepcional que o Admin decidir. Não é a porta normal.
- Senha, quando existe: definida pelo Admin, mínimo **10 caracteres**, hash bcrypt (cost 12 em produção). `senhaHash` passa a ser opcional no modelo: usuário que nunca teve senha não tem hash.
- Não existe "esqueci a senha". A recuperação é entrar pelo Google; se a senha de reserva se perdeu, o Admin redefine.

### 2.4 Tela de login

Botão "Entrar com Google" em destaque. O formulário de e-mail e senha fica recolhido atrás de um link discreto ("entrar com senha"), e só funciona para quem tem `permiteSenha`. Mensagem de erro é sempre a mesma: "Não foi possível entrar. Confira a conta usada ou fale com o administrador."

> **Ajuste 13/11/2026 (homolog, feedback Luís): se ninguém pode, a opção não aparece.** `GET /auth/config` devolve `senhaDisponivel` = existe usuário ativo com `permiteSenha`. Com `false`, o link "entrar com senha" não é renderizado. A regra é global, não por e-mail, de propósito: antes de se identificar a tela não sabe quem é o usuário, e perguntar o e-mail para decidir revelaria quais contas aceitam senha (§11.3). Em produção, com todos no Google, a tela mostra só o botão do Google.

### 2.5 Limite de tentativas, bloqueio e registro de acessos

- **Limite por IP:** 10 tentativas por minuto nas rotas `POST /auth/login` e `POST /auth/google`. Acima disso, `429`.
- **Bloqueio temporário por usuário (só senha):** 10 falhas seguidas bloqueiam a entrada por senha daquele usuário por 15 minutos. A entrada pelo Google não é bloqueada por isso (o Google já protege a conta). O bloqueio não é revelado na resposta.
- **Registro de acessos (`AcessoUsuario`, §9):** toda tentativa, com sucesso ou não, grava forma (`GOOGLE` | `SENHA` | `REFRESH`), resultado, motivo da falha (interno), IP, agente e horário no fuso do Brasil. Fica visível em Usuários e permissões (últimos acessos de cada usuário) e o próprio usuário vê os seus em "Minha conta".
- **Encerrar todas as sessões:** botão no cadastro do usuário (Admin) e em "Minha conta" que revoga todos os refresh tokens; em até 15 minutos o acesso cai em todos os dispositivos (§3.1).

> **Como foi aplicado no bloco 2 (13/11/2026) — divergências e escolhas anotadas, não resolvidas em silêncio:**
> 1. **Limite por IP é por rota:** `POST /auth/login` e `POST /auth/google` têm contadores separados (10/min cada), pelo `@nestjs/throttler` com guard só nessas duas rotas (`LoginThrottlerGuard`); `/auth/refresh` não tem limite — toda a equipe atrás do mesmo NAT renova a cada 15 min. Resposta `429 { erro: 'muitas_tentativas' }` (api-spec §5). O IP real vem do `X-Forwarded-For` do Traefik (`trustProxy: true` no Fastify).
> 2. **Bloqueio temporário por usuário fica em memória do processo** (`ControleBloqueioSenha`), não no Redis: o backend roda com uma réplica e o contador é proteção, não estado de negócio — reiniciar o serviço zera as contagens. Se o backend ganhar réplicas, trocar por Redis com a mesma interface. A entrada por senha de um usuário bloqueado registra motivo `bloqueado`; a 10ª falha já é registrada como `bloqueado` (foi ela que disparou).
> 3. **`REFRESH` só é registrado em falha** (token inexistente, revogado, expirado ou usuário inativo). Registrar cada renovação bem-sucedida (uma a cada 15 min por sessão aberta) poluiria os "últimos 50 acessos" sem dizer nada sobre a entrada da pessoa. Consequência: o `emailTentado` é nulo quando o token é desconhecido (§9).
> 4. **"Minha conta" mostra os acessos SEM o motivo interno** (forma, resultado, IP, dispositivo, quando); o motivo (`senha_desligada`, `sub_divergente`…) aparece só em Usuários e permissões, para o Admin. O doc não distinguia; a resposta genérica (§2.4) perderia sentido se o próprio usuário visse "senha desligada" na lista.
> 5. **Desativar um usuário, excluí-lo e "religar conta Google" também encerram as sessões dele** (as sessões antigas podem ser do dono anterior do e-mail). Não estava escrito; é o comportamento seguro.
> 6. **O e-mail da senha de reserva também aceita os dois domínios** (mesma função de localização `localizarPorEmail`, pela parte local): o doc só falava do Google, mas dois caminhos de busca divergentes seriam bug esperando.
> 7. **Criação de usuário recusa a mesma caixa nos dois domínios** (`joao@azit.com.br` e `joao@azitmove.com.br` não viram dois usuários) e só ADMIN liga `permiteSenha` — na criação também (DIRETOR cria usuários, mas sem senha).

---

## 3. Estratégia de tokens

O console interno usa o par **access token + refresh token**.

### 3.1 Access token

- **Duração:** 15 minutos
- Vai em toda requisição no header `Authorization: Bearer <token>`
- Carrega identidade e roles (ver seção 4)
- Curto por design: se vazar, a janela de exposição é mínima
- Não é revogável individualmente — a curta duração é a proteção

### 3.2 Refresh token

- **Duração:** 7 dias
- Usado **somente** para obter um novo access token quando ele expira
- Armazenado no banco (modelo `RefreshToken`), permitindo revogação
- **Revogável:** o campo `revogado` permite invalidar a sessão de um usuário específico sem afetar os demais (logout forçado, suspeita de comprometimento)
- A cada renovação, considerar rotação: emitir novo refresh token e revogar o anterior

### 3.3 Fluxo de renovação

1. Access token expira → cliente recebe `401`
2. Cliente envia o refresh token para `POST /api/v1/auth/refresh`
3. Sistema valida o refresh token: existe, não expirou, não está revogado
4. Se válido: emite novo access token (e opcionalmente novo refresh token, rotacionando)
5. Se inválido/revogado: `401` — cliente precisa fazer login novamente

### 3.4 Logout

`POST /api/v1/auth/logout` → revoga o refresh token atual (`revogado = true`). O access token continua válido até expirar (máximo 15 min), o que é aceitável dado o tempo curto.

---

## 4. Payload do JWT

O access token carrega o mínimo para autenticar e autorizar sem consultar o banco a cada requisição.

```json
{
  "sub": "id-do-usuario",
  "roles": ["DIRETOR", "ADMIN", "APROVADOR"],
  "iat": 1719360000,
  "exp": 1719360900
}
```

| Campo | Significado |
|---|---|
| `sub` | ID do usuário (subject) |
| `roles` | Lista de roles do usuário — autorização grossa |
| `iat` | Issued at (timestamp de emissão) |
| `exp` | Expiration (timestamp de expiração) |

### 4.1 O que NÃO entra no token

**Limites de alçada não entram no token.** O limite de aprovação é um dado de negócio que muda e precisa estar sempre atualizado. Se estivesse no token, um aprovador cujo limite foi reduzido continuaria aprovando com o limite antigo até o token expirar. O limite é **sempre consultado no banco** no momento da aprovação (ver seção 6).

A divisão é clara:
- **No token:** identidade (`sub`) e roles — mudam raramente, autorização grossa
- **No banco, sempre fresco:** limites de alçada — mudam, autorização fina sensível a valor

---

## 5. Roles e RBAC

### 5.1 Modelo de acúmulo

Um usuário tem **múltiplos roles que se somam**. As permissões são a união de todos os roles do usuário. É RBAC clássico — o modelo que bancos e ERPs usam porque pessoas reais acumulam papéis.

Exemplo real: um diretor que também administra o sistema e participa das alçadas tem os roles `[DIRETOR, ADMIN, APROVADOR]` simultaneamente, e suas permissões são a soma dos três.

No schema, isso é a tabela de junção `UsuarioRole` (muitos-para-muitos) — ver Doc 5.

### 5.2 Roles internos

| Role | Responsabilidade |
|---|---|
| **DIRETOR** | Visão total, decisões estratégicas, participa de alçadas de alto valor |
| **ADMIN** | Administração do sistema: usuários, configurações, parâmetros |
| **APROVADOR** | Participa das alçadas de aprovação (renegociações, despesas, etc.) |
| **OPERADOR** | Opera o dia a dia: registra renegociação, cobrança, bloqueio |
| **FINANCEIRO** | Executa pagamentos já aprovados, sem poder de decisão |

### 5.3 Papéis externos não são roles

"Cliente" e "investidor" **não são roles** deste sistema. São papéis derivados do que a Conta do titular possui:

- Titular com `ContratoCredito` → exerce o papel de cliente → acessa o módulo cliente
- Titular com `ContratoInvestimento` → exerce o papel de investidor → acessa o módulo investidor

O papel é calculado a partir do conteúdo da conta, nunca armazenado como um role no token do titular.

### 5.4 Áreas de trabalho são autorização, não só menu *(v1.1)*

O doc 02 §16 define o modelo em dois níveis: **papel → áreas padrão** (matriz papel × área, editável) **± exceções por usuário**. As áreas são as da navegação (Comercial, Análise de cadastro, Contratos, Carteira e cobrança, Financeiro administrativo, Pessoas, Ativos e frota, Capital e investimento, Produtos, Aprovações, Configurações).

**Problema encontrado em 12/11/2026 (Luís):** analista sem a área Análise de cadastro entrava na tela de análise. Causa: a área só era consultada pelo menu lateral, pelo sino e pelo Início. As rotas da tela não checavam nada e a API checava só papel, onde `OPERADOR` é aceito em quase tudo. A área era decoração.

**Regra a partir da v1.1:**

1. **A área é a unidade de autorização de acesso.** Cada módulo da API declara a(s) área(s) a que pertence (§7.5, mapa na §13). Quem não tem a área recebe `403 acesso_negado`, mesmo que tenha o papel.
2. **Papel continua valendo para o que é dele:** alçadas e decisão de aprovação (`APROVADOR`, `DIRETOR`), administração (`ADMIN`), execução financeira (`FINANCEIRO`). Dentro de uma área, ação sensível pode continuar exigindo papel: os dois guards se somam.
3. **Rotas da tela declaram a área.** O roteador do frontend carrega a área de cada rota e redireciona para a página "Sem acesso a esta área" quando o usuário não a tem. Links entre telas (proposta → análise, contrato → carteira) aparecem desabilitados com a explicação em vez de abrir e falhar.
4. **Uma conta só.** A função que calcula as áreas efetivas de um usuário (papéis × matriz ± exceções) existe **uma vez** no backend (`PermissoesService.areasEfetivas`) e é usada pelo guard, pelo sino, pelo Início e por `GET /me/areas`. Hoje está escrita três vezes; consolidar faz parte do bloco.
5. **Área não vai no token.** Como o limite de alçada (§4.1), a área muda por ação do Admin e precisa valer na hora. O guard consulta o banco com cache curto em memória (60 s) invalidado em toda mutação de usuário, matriz ou exceção.
6. **Rota sem área é exceção declarada.** Módulos de apoio que servem a qualquer usuário autenticado (sessão, sino, Início, preferências, consulta FIPE) levam `@AreaLivre()` com justificativa no código. Controller sem nenhum dos dois decorators falha no boot: ninguém esquece de classificar.

---

## 6. Alçadas de aprovação

### 6.1 Conceito

A alçada é a estrutura que define **quem pode aprovar o quê, até que limite de valor**. É transversal — aplica-se a renegociações, financiamento de despesas, venda de produtos, e qualquer operação com risco ou exceção (conforme definido no Doc 2, seção 7.9).

### 6.2 Separação entre role e limite

Ter o role `APROVADOR` significa apenas que o usuário **participa de alguma alçada**. O **limite** de cada aprovador é um dado configurável à parte:

- Dois usuários podem ambos ter o role `APROVADOR`
- Um aprova operações até R$ 100.000, outro até R$ 10.000
- O limite é configuração de negócio, parametrizável, com histórico

### 6.3 Estrutura configurável

A alçada é modelada como estrutura própria (não hardcoded), permitindo configurar:

- **Tipo de operação** — renegociação, despesa, venda, etc.
- **Faixa de valor** — limites mínimo e máximo que cada nível aprova
- **Nível de escalonamento** — se a operação excede o limite de um aprovador, sobe para o nível superior

> ⚠️ **Placeholder:** As regras específicas de alçada (valores exatos dos limites, níveis, quem aprova o quê) são definidas com Vicente. A estrutura técnica deve ser configurável desde já; os valores entram como configuração, não como código.

### 6.4 Verificação no momento da aprovação

Quando um aprovador tenta aprovar uma operação:

1. Sistema verifica que o usuário tem o role `APROVADOR` (do token)
2. Sistema consulta no **banco** o limite atual daquele aprovador para aquele tipo de operação
3. Se o valor da operação está dentro do limite: aprovação permitida
4. Se excede: operação escala para o nível superior

O passo 2 sempre vai ao banco — nunca ao token — garantindo que o limite esteja sempre atualizado.

---

## 7. Guards e proteção de rotas

### 7.1 JwtAuthGuard

Guard global que valida o access token em toda requisição (exceto rotas públicas como login). Extrai o payload e popula `request.user` com `{ id, roles }`.

```typescript
// Aplicado globalmente, com exceção das rotas marcadas @Public()
@UseGuards(JwtAuthGuard)
```

### 7.2 Rotas públicas

Decorator `@Public()` marca rotas que dispensam autenticação:

```typescript
@Public()
@Post('login')
async login(@Body() dto: LoginDto) { ... }
```

Rotas públicas no V1: `POST /auth/login`, `POST /auth/refresh`, e o webhook do Asaas (que usa validação de assinatura própria, não JWT). *(v1.1)* Entram `POST /auth/google` (§2.2) e as rotas `/publico` da Fatura Azit (doc 02 §32, autenticadas por token da própria fatura).

### 7.3 RolesGuard

Guard de autorização que verifica se o usuário tem ao menos um dos roles exigidos pela rota. Usa o decorator `@Roles()`:

```typescript
@Roles('OPERADOR', 'DIRETOR')
@Post('contratos/:id/bloquear')
async bloquear(...) { ... }
```

A verificação é por **interseção**: o usuário precisa ter pelo menos um dos roles listados. Como as permissões se somam, um diretor que também é operador passa em qualquer rota que exija um ou outro.

### 7.4 Webhook do Asaas

O endpoint de webhook não usa JWT — usa validação da assinatura do Asaas (`ASAAS_WEBHOOK_SECRET`). É autenticação de origem, não de usuário. Ver Doc da API.

### 7.5 AreaGuard *(v1.1)*

Guard global que roda depois do `JwtAuthGuard` e antes do `RolesGuard`. Lê o decorator `@Area()` da classe (ou do método, que sobrepõe) e nega quem não tem nenhuma das áreas listadas:

```typescript
@Area(AreaSistema.ANALISE_CADASTRO)
@Controller()
export class AnaliseController { ... }

// Módulo compartilhado por duas áreas: basta ter uma.
@Area(AreaSistema.COMERCIAL, AreaSistema.PESSOAS)
@Controller('titulares')
export class TitularController { ... }

// Apoio a qualquer usuário autenticado — exceção explícita.
@AreaLivre('sessão do próprio usuário')
@Controller('auth')
export class AuthController { ... }
```

- Áreas efetivas vêm de `PermissoesService.areasEfetivas(usuarioId)` (§5.4, item 4), nunca do token.
- Resposta: `403 { erro: 'acesso_negado', mensagem: 'Sem acesso à área Análise de cadastro', area: 'ANALISE_CADASTRO' }` (formato no api-spec §5). A tela usa o campo `area` para mostrar "Sem acesso à área Análise de cadastro — peça ao administrador"; o nome por extenso vem de `NOME_AREA` em `@azit/types`, fonte única da API e da tela.
- `ADMIN` **não** é curinga de área: Admin tem as áreas que a matriz lhe dá (por padrão, todas). Se o Admin retirar uma área de si mesmo, perde o acesso a ela como qualquer um; isso é desejado para testar permissões.
- Controller sem `@Area` nem `@AreaLivre` derruba o boot com a lista dos faltantes. Teste automatizado percorre todos os controllers e falha se algum ficar sem classificação.

---

## 8. Autenticação do Titular (desenho — implementação futura)

Esta seção desenha a estrutura. A **implementação** é fase futura, junto com as telas dos módulos cliente/investidor (fora do escopo do V1 conforme Doc 3).

### 8.1 Princípio

O Titular autentica **uma vez** e acessa **a própria conta**. Os módulos cliente/investidor são visões condicionais dentro da conta, determinados pelo que ela possui. Não há login separado por módulo.

### 8.2 Identidade do titular

- **Identificador:** CPF/CNPJ (o mesmo do cadastro único)
- **Fator de autenticação:** a definir na implementação — provavelmente CPF + senha numérica ou código por WhatsApp, dado que o público é motorista de aplicativo
- A autenticação do titular é **separada** da do Usuario interno — entidade própria, fluxo próprio, segredo de assinatura próprio

### 8.3 Resolução de módulos

Após autenticar, o sistema determina o que o titular vê consultando a conta dele:

```
titular → conta → 
  tem ContratoCredito?      → habilita módulo cliente
  tem ContratoInvestimento? → habilita módulo investidor
```

Se tem os dois, ambos os módulos aparecem como abas/seções dentro da mesma sessão. O front-end alterna entre eles sem novo login.

### 8.4 Payload do token do titular (desenho)

```json
{
  "sub": "id-do-titular",
  "tipo": "titular",
  "conta_id": "id-da-conta",
  "iat": ...,
  "exp": ...
}
```

Note que **não há roles** no token do titular — o que ele acessa é derivado da conta, consultada quando necessário. O campo `tipo: "titular"` distingue do token de Usuario interno, impedindo que um token cruze de um mundo para o outro.

### 8.5 Privacidade do investidor (regra de anonimização)

Quando um titular acessa o **módulo investidor**, ele vê o **fluxo financeiro** dos ativos/fundo sob sua gestão — recebíveis, rendimentos, performance, valores. Mas **nunca vê dados pessoais do cliente** que financiou o ativo: nome, CPF, contato, ou qualquer identificação.

Fundamentos:
- **LGPD:** o cliente não consentiu em expor seus dados ao investidor.
- **Proteção do negócio:** a Azit é intermediária; expor as partes uma à outra arrisca a desintermediação (analogia da imobiliária que blinda locador e locatário).

Implicação técnica: as queries que alimentam as visões do investidor (Bloco 8 do backlog — 8.4, 8.5) devem projetar **apenas dados financeiros e do ativo** (ex: "Veículo Onix 2022 · rendeu R$ X este mês"), **nunca** juntar dados do Titular-cliente. A camada de serviço do módulo investidor não tem permissão de ler campos pessoais do cliente. Mesmo que o investidor e o cliente estejam na mesma base de Titulares, o investidor enxerga o ativo e o fluxo, não a pessoa do outro lado.

> Esta é uma regra de **autorização a nível de dado**, não apenas de rota. Não basta proteger o endpoint — a projeção de dados precisa excluir os campos pessoais do cliente na origem.

---

## 9. Modelos de dados

Os modelos `Usuario`, `UsuarioRole`, `RoleUsuario` (enum) e `RefreshToken` estão definidos no Doc 5. Resumo do que serve à autenticação:

```prisma
model Usuario {
  id            String        @id @default(cuid())
  nome          String
  email         String        @unique
  senhaHash     String?       // (v1.1) opcional: quem nunca teve senha não tem hash
  permiteSenha  Boolean       @default(false) // (v1.1) entrada por senha liberada pelo Admin
  googleSub     String?       @unique         // (v1.1) id imutável da conta Google, gravado no 1º acesso
  ativo         Boolean       @default(true)
  roles         UsuarioRole[]
  refreshTokens RefreshToken[]
  acessos       AcessoUsuario[]            // (v1.1)
  // ...
}

// (v1.1) Registro de acessos — toda tentativa, com ou sem sucesso (§2.5).
// Aplicado 13/11/2026 (tabela acessos_usuario, migration 20261113120000). Divergência
// do desenho: `emailTentado` ficou OPCIONAL — falha de REFRESH com token desconhecido
// e ID token do Google recusado antes de ler o e-mail não têm e-mail para gravar.
model AcessoUsuario {
  id         String   @id @default(cuid())
  usuarioId  String?  // null quando o e-mail não corresponde a ninguém (fica só o emailTentado)
  emailTentado String? // null em falha de refresh/token sem e-mail (ver acima)
  forma      FormaAcesso   // GOOGLE | SENHA | REFRESH (REFRESH só em falha — §2.5, nota 3)
  sucesso    Boolean
  motivo     String?  // interno: dominio_invalido, sub_divergente, senha_desligada, bloqueado, senha_invalida…
  ip         String?
  agente     String?
  em         DateTime @default(now())
  usuario    Usuario? @relation(fields: [usuarioId], references: [id])
  @@index([usuarioId, em])
  @@index([emailTentado, em])
}

// (v1.1) Preferência de alerta por e-mail (§12) — por usuário, padrão ligado.
// Entra como chave em `Usuario.preferencias` (Json já existente): { "emailAlertas": true }.

model UsuarioRole {
  usuarioId String
  role      RoleUsuario
  usuario   Usuario @relation(fields: [usuarioId], references: [id])
  @@id([usuarioId, role])
}

model RefreshToken {
  id        String   @id @default(cuid())
  usuarioId String
  token     String   @unique
  expiraEm  DateTime
  revogado  Boolean  @default(false)
  usuario   Usuario  @relation(fields: [usuarioId], references: [id])
}
```

### 9.1 Estrutura de alçada (a detalhar com Vicente)

A estrutura de alçada precisa de modelos próprios, ainda a definir em detalhe. O esqueleto sugerido:

```prisma
// ESBOÇO — valores e regras a definir com Vicente
model Alcada {
  id            String   @id @default(cuid())
  usuarioId     String   // o aprovador
  tipoOperacao  String   // acordo | novacao | despesa | venda | ...
  limiteMaximo  Decimal  @db.Decimal(12, 2)
  ativo         Boolean  @default(true)
  // histórico via createdAt/updatedAt
}
```

Este modelo não entra no V1 de autenticação — entra quando o fluxo de alçadas for implementado. Fica registrado aqui para que a estrutura de roles já o antecipe.

### 9.2 Entidade de autenticação do titular (futura)

Quando a autenticação do titular for implementada, ela ganha entidade própria — algo como `TitularAuth` com credencial e fator, separada do Usuario. Não é modelada agora; fica registrada como decisão de desenho.

---

## 10. Fluxos de autenticação

### 10.1 Login interno pelo Google *(v1.1 — caminho normal)*

```
POST /api/v1/auth/google
  body: { credential }            ← ID token emitido pelo Google ao navegador
  → valida assinatura, aud, iss, exp, email_verified
  → hd e domínio do e-mail ∈ DOMINIOS_WORKSPACE (azit.com.br, azitmove.com.br)
  → localiza Usuario ativo pela parte local do e-mail
  → googleSub: grava no 1º acesso; nos seguintes exige igualdade
  → gera access token (15min) + refresh token (7d), persiste o refresh
  → registra AcessoUsuario { forma: GOOGLE, sucesso: true }
  → retorna { accessToken, refreshToken, usuario: { id, nome, roles } }
  falha em qualquer passo → 401 genérico + AcessoUsuario { sucesso: false, motivo }
```

### 10.1-A Login interno por senha (reserva, só com `permiteSenha`)

```
POST /api/v1/auth/login
  body: { email, senha }
  → limite por IP (429) e bloqueio temporário do usuário (10 falhas / 15 min)
  → Usuario ativo, permiteSenha = true, senhaHash presente
  → bcrypt.compare
  → gera access token (15min) + refresh token (7d)
  → registra AcessoUsuario { forma: SENHA, … }
  → retorna { accessToken, refreshToken, usuario: { id, nome, roles } }
  qualquer falha (inclusive permiteSenha = false) → o MESMO 401 genérico
```

### 10.2 Requisição autenticada

```
GET /api/v1/contratos-credito
  header: Authorization: Bearer <access_token>
  → JwtAuthGuard valida o token
  → popula request.user = { id, roles }
  → AreaGuard (v1.1) confere a área do módulo contra as áreas efetivas do usuário (banco, cache 60 s)
  → RolesGuard verifica roles se a rota exige
  → controller executa
```

### 10.3 Renovação

```
POST /api/v1/auth/refresh
  body: { refreshToken }
  → valida: existe, não expirado, não revogado
  → emite novo access token
  → (opcional) rotaciona refresh token
  → retorna { accessToken, refreshToken? }
  (v1.1, 13/11) falha → 401 refresh_invalido + AcessoUsuario { forma: REFRESH, sucesso: false };
                sucesso NÃO registra acesso (§2.5, nota 3)
```

### 10.4 Aprovação com alçada

```
POST /api/v1/acordos/:id/aprovar
  header: Authorization: Bearer <access_token>
  → JwtAuthGuard valida
  → RolesGuard exige role APROVADOR
  → service consulta NO BANCO o limite do aprovador
  → se valor do acordo ≤ limite: aprova
  → se excede: escala para nível superior
```

---

## 11. Notas de implementação e segurança

### 11.1 Segredos

- `JWT_SECRET` — segredo de assinatura do access token interno. String longa e aleatória, nunca commitada (já no `.env.example` do Doc 4).
- Quando a autenticação do titular for implementada, ela usa um **segredo de assinatura separado** — tokens dos dois mundos nunca devem ser intercambiáveis.

### 11.2 Hash de senha

- bcrypt cost 12 ou argon2id
- Nunca logar senha, nem em texto nem em hash
- A comparação é sempre via função do algoritmo (`bcrypt.compare`), nunca comparação manual de strings

### 11.3 Proteções obrigatórias

- **Rate limiting** nas rotas de entrada (`/auth/login`, `/auth/google`): 10 tentativas por minuto por IP → `429`. *(v1.1: estava previsto desde a v1.0 e não havia sido implementado; entra no bloco de login.)*
- **Bloqueio temporário por usuário** na entrada por senha: 10 falhas seguidas → 15 minutos (§2.5).
- **Resposta genérica** em falha de login — não revelar se email existe, se a senha está desligada ou se foi a senha
- **Registro de acessos** de toda tentativa (§2.5) — o motivo real fica no registro, nunca na resposta
- **HTTPS obrigatório** em produção — tokens nunca trafegam em texto claro
- **CORS** restrito ao domínio do frontend (já configurado no `main.ts` do Doc 4)
- **ID token do Google só é aceito com `aud` igual ao nosso `GOOGLE_CLIENT_ID`** — token emitido para outro aplicativo é recusado mesmo sendo do nosso domínio

### 11.4 Revogação e logout

- Logout revoga o refresh token (`revogado = true`)
- Em caso de comprometimento de conta, revogar todos os refresh tokens daquele usuário força novo login em todos os dispositivos
- O access token não é revogável — a duração de 15 min é a mitigação

### 11.5 Escopo do V1

| Item | V1 |
|---|---|
| Autenticação Usuario interno (login, refresh, logout) | ✅ Em produção |
| RBAC com múltiplos roles | ✅ Em produção |
| Guards (JwtAuthGuard, RolesGuard) | ✅ Em produção |
| Estrutura de alçada configurável | ✅ Em produção (matriz papel × operação, doc 02 §7.9) |
| Autenticação do Titular | 📐 Desenhada; implementação futura |
| Telas dos módulos cliente/investidor | 📐 Fora do V1 (Doc 3) |

### 11.6 Blocos da revisão 1.1 (ordem decidida com Luís, 12/11/2026)

| Bloco | Conteúdo | Por que nesta ordem |
|---|---|---|
| **1. Áreas como autorização** | `PermissoesService.areasEfetivas` única; `AreaGuard` + `@Area`/`@AreaLivre` em todos os controllers (mapa §13); rotas da tela com área e página "Sem acesso"; links entre áreas desabilitados; teste que cobre todos os controllers | Fecha o furo aberto hoje (analista entrando na análise). Não depende de nada externo. |
| **2. Entrar com Google + senha opcional** — **CONSTRUÍDO 13/11/2026, aguarda homolog** (mesma branch do bloco 1) | `POST /auth/google` + `GET /auth/config`; `googleSub`, `permiteSenha`, `senhaHash` opcional (migration 20261113120000); liga/desliga por usuário no Admin (motivo auditado); rate limit por IP (throttler); bloqueio temporário em memória; `AcessoUsuario` com tela (últimos acessos em Usuários e permissões e em "Minha conta", encerrar sessões, religar conta Google); tela de login nova; card "Google — entrada no sistema" em Integrações; auto-bloqueio §13.3 | Depende do cliente OAuth criado pelo Luís no Google Cloud da empresa (deploy/AMBIENTES.md §1.5). Migração: usuários existentes continuam com `permiteSenha = false`; o Admin liga para si antes do deploy em produção, como rede de segurança, e desliga depois de entrar pelo Google — passo a passo em deploy/AMBIENTES.md §1.6. Escolhas e divergências: §2.5 (nota), §9, §13.3. |
| **3. Alertas por e-mail** | §12: remetente, fila, eventos, preferência por usuário, tela | Depende do mesmo projeto Google (conta de serviço) e das notificações dirigidas já existentes. Serve também à Fatura Azit (doc 02 §32). |

Cada bloco é uma branch, um homolog e uma tag. Nenhum vai para produção sem validação do Luís no homolog.

---

## 12. Alertas por e-mail *(v1.1)*

> **Decisão Luís, 12/11/2026.** O sistema avisa por e-mail quando alguém tem **aprovação esperando por ele** ou quando **uma solicitação dele teve retorno**. Hoje isso só aparece no sino, e quem não está com o Hub aberto não fica sabendo.

### 12.1 O que o e-mail é, e o que não é

- O e-mail é um **segundo canal da notificação interna** já existente (doc 02 §16.1). Não há um sistema de e-mail à parte: a mesma `Notificacao` que acende o sino dispara o e-mail quando é **dirigida a um usuário** e o tipo está na lista da §12.2.
- Notificação **por área** (ex.: "nova aprovação na área Aprovações") ou **geral** (falha de job) **não** vira e-mail. E-mail para a área inteira vira ruído e é ignorado em uma semana.
- O e-mail **não substitui** a fila de trabalho (Início e Central de Aprovações). Ele leva a pessoa até lá.

### 12.2 Eventos que geram e-mail

| Evento | Destinatário | Assunto (modelo) |
|---|---|---|
| Aprovação criada ou escalada | cada usuário que **pode decidir** aquela operação pela matriz de alçada (doc 02 §7.9), excluído o solicitante | "Aprovação esperando por você: {operação}" |
| Pedido de complemento | solicitante | "Pediram complemento na sua solicitação: {operação}" |
| Complemento respondido | quem pediu o complemento | "Responderam o complemento: {operação}" |
| Decisão tomada (aprovada / não aprovada / recomendada / escalada) | solicitante | "Sua solicitação foi {decisão}: {operação}" |

Os destinatários de "pode decidir" saem da mesma função que a Central usa para listar o que cada um pode aprovar; **não** é "todo mundo com a área Aprovações".

### 12.3 Regras

1. **Sem dados pessoais do cliente no e-mail.** O e-mail sai do perímetro do sistema (caixa, celular, encaminhamento). Vai: tipo de operação, valor quando houver, quem solicitou, data e o **link** para o ocorrido. **Não vai** nome, CPF, telefone nem placa do cliente. Quem quiser detalhe clica e entra autenticado. Mesma lógica da Regra 14.
2. **Um e-mail por evento por destinatário**, nunca repetição. Se a pessoa já decidiu ou já leu a notificação antes do envio sair da fila, o e-mail é descartado.
3. **Assíncrono, sempre.** O evento grava a notificação e enfileira o e-mail (BullMQ, fila `email`, 3 tentativas com espera crescente). Falha de envio nunca derruba a operação que o gerou e aparece como notificação de falha de sistema.
4. **Preferência por usuário:** "Receber alertas por e-mail", ligada por padrão, em "Minha conta". Desligar não desliga o sino.
5. **Horário:** envio imediato. Alerta de aprovação é trabalho, não cobrança; não há janela de horário como no POP de cobrança (doc 02 §28).
6. **Idioma e tom:** português, curto, sem termos financeiros vedados (ver memória de vocabulário): "Compra Parcelada", "Reembolso Parcelado", nunca "financiamento".

### 12.4 Envio

- **Remetente:** uma caixa do próprio Workspace (nome a definir pelo Luís, sugestão `hub@azitmove.com.br`), enviando pela **API do Gmail com conta de serviço e delegação de domínio**, no mesmo projeto Google Cloud do login. Sem fornecedor terceiro, sem custo, SPF e DKIM já são os do Workspace. Limite do Gmail (2.000 envios/dia por caixa) está muito acima do volume de aprovações.
- **Configuração:** `EMAIL_REMETENTE` e o JSON da conta de serviço em segredo do ambiente (`GOOGLE_SERVICE_ACCOUNT_JSON`), nunca no repositório. Sem configuração, a fila registra "e-mail não configurado" e segue: o sino continua funcionando.
- **Modelo de e-mail:** um modelo só, texto com um botão "Abrir no Hub". Sem HTML pesado, sem imagem externa.
- **Rastro:** cada envio grava em `Notificacao` o horário em que o e-mail saiu (`emailEnviadoEm`) e, em falha definitiva, o motivo. Visível na auditoria da notificação.
- **Fatura Azit (doc 02 §32)** usa o mesmo serviço de envio e a mesma fila, com remetente e modelo próprios. Essa é a razão de o serviço de e-mail nascer genérico (`EmailService.enviar({ para, assunto, corpo, origem })`) e não dentro do módulo de notificação.

---

## 13. Mapa módulo → área *(v1.1)*

> **Estado: APLICADO no bloco 1 (13/11/2026).** A tabela abaixo é o que está nos controllers
> (`@Area` / `@AreaLivre`) e nas rotas do frontend (`handle.area` em `router.tsx`). O ponto de
> partida da v1.1 está no histórico do git (commit e821009); o que mudou dele para cá está em
> **13.2 Divergências**, decididas pelo uso real e sinalizadas aqui — não resolvidas em silêncio.
>
> Regra de desempate (mantida): rota que serve a duas áreas lista as duas (basta ter uma); um
> endpoint de **leitura** usado por telas de várias áreas entra com todas as áreas que o consomem,
> e a **primeira** listada é a área dona (é ela que vai no `area` do 403); a **escrita** fica só com
> a área dona. Os dois conjuntos compartilhados têm nome único no código, para backend e frontend
> não divergirem:
>
> - `AREAS_CONTRATO` = CONTRATOS, CARTEIRA_COBRANCA, COMERCIAL — detalhe do contrato (`/contratos/:id`).
> - `AREAS_FICHA_TITULAR` = PESSOAS, COMERCIAL — ficha do titular (`/titulares/:id`).

### 13.1 Mapa aplicado

| Módulo (API) | Área da classe | Exceções por rota (método sobrepõe classe) |
|---|---|---|
| `funil` (leads, simulações, propostas, formalização, ativação), `originacao` | COMERCIAL | `POST propostas/:id/conferir-veiculo` e `DELETE propostas/:id/documentos/:docId` + ANALISE_CADASTRO (a análise confere o veículo e limpa documento — doc 02 §31); `GET propostas/documentos/:docId/download` + ANALISE_CADASTRO, PESSOAS (ficha baixa anexos); `GET contratos/:id/status-formalizacao` + `AREAS_CONTRATO` (bloco de assinatura no detalhe do contrato) |
| `fipe` | `@AreaLivre` | tabela de referência pública, sem dado do negócio (§5.4 item 6) |
| `analise` | ANALISE_CADASTRO | `POST propostas/:id/analise` (ponte proposta → análise, idempotente) + COMERCIAL; `GET analises/:id` + APROVACOES (dossiê COCAD na Central); `GET titulares/:id/consultas-biro` + `AREAS_FICHA_TITULAR` |
| `dossie` (dossiê para judicialização, doc 02 §30) | `AREAS_CONTRATO` | `POST empresa/contrato-social` → CONFIGURACOES; `GET empresa/parametros` e `GET empresa/contrato-social/pdf` → CONFIGURACOES + `AREAS_CONTRATO` |
| `contrato` | `AREAS_CONTRATO` | — (inclui `cancelar` e `transferencia-efetivada`; ver 13.2) |
| `assinatura` (ZapSign) | `AREAS_CONTRATO` | `GET/POST assinatura/parametros` → CONFIGURACOES; `POST webhooks/zapsign` `@Public` |
| `conta` (carteira) | CARTEIRA_COBRANCA | `GET contas/:id`, `GET contas/por-titular/:titularId` + `AREAS_FICHA_TITULAR` |
| `cobranca` (faturas, cobranças, conferência Asaas) | CARTEIRA_COBRANCA | `GET contratos/:id/extrato` → `AREAS_CONTRATO`; `GET contas/:id/faturas`, `GET contas/:id/lancamentos`, `GET faturas/:id` + `AREAS_FICHA_TITULAR`; `POST webhooks/asaas` `@Public` |
| `regua` | CARTEIRA_COBRANCA | — |
| `operacoes` (renegociação, novação, quitação, sinistro, reajuste, rescisão) | CARTEIRA_COBRANCA | `GET acordos/:id`, `GET novacoes/:id` + APROVACOES (dossiê da aprovação); `GET contas/:id/renegociacao/elegivel`, `POST …/renegociacao/simular`, `POST …/novacao/simular` + `AREAS_FICHA_TITULAR`; `GET contas/:id/novacao/decomposicao` + APROVACOES + `AREAS_FICHA_TITULAR`; prévias/listas do contrato (`quitacao/simular`, `reajustes`, `rescisao/previa`, `rescisoes`) → `AREAS_CONTRATO`; escritas do contrato (`quitacao`, `sinistro`, `reajuste`, `rescisao`, `rescisoes/:id/devolucao`) → CARTEIRA_COBRANCA, CONTRATOS |
| `migracao-legado` | CARTEIRA_COBRANCA | — |
| `credito` (crédito avulso / Reembolso Parcelado na ficha) | COMERCIAL, PESSOAS, CARTEIRA_COBRANCA | — (não constava no mapa inicial) |
| `contas-pagar` (`/financeiro`) | FINANCEIRO_ADMINISTRATIVO | `GET fornecedores`, `POST fornecedores` + `AREAS_FICHA_TITULAR` (a ficha cadastra o fornecedor ao contratar Reembolso Parcelado) |
| `centro-custo` (custo por ativo) | ATIVOS_FROTA, FINANCEIRO_ADMINISTRATIVO | — |
| `titular` | PESSOAS, COMERCIAL | `GET titulares`, `GET titulares/buscar` + CAPITAL_INVESTIMENTO (vincular investidor à estrutura) |
| `ativo` | ATIVOS_FROTA | leituras (`GET`, `buscar`, `:id`, `:id/documentos`, `documentos/:id/download`) + COMERCIAL, CAPITAL_INVESTIMENTO |
| `frota` (ocorrências) | ATIVOS_FROTA | — |
| `origem-capital` | ATIVOS_FROTA, CAPITAL_INVESTIMENTO | — |
| `capital` (estruturas jurídicas, pessoas classificadas) | CAPITAL_INVESTIMENTO | `GET pessoas`, `GET/POST/DELETE titulares/:id/classificacoes` → PESSOAS, CAPITAL_INVESTIMENTO (tela Pessoas); `GET estruturas` + ATIVOS_FROTA, PRODUTOS, FINANCEIRO_ADMINISTRATIVO (listas de vínculo) |
| `investimento` | CAPITAL_INVESTIMENTO | `GET titulares/:id/contratos-investimento`, `GET contas/:id/visao-geral` + `AREAS_FICHA_TITULAR` |
| `catalogo` | PRODUTOS | `GET catalogo/avulsos` + `AREAS_FICHA_TITULAR`, CARTEIRA_COBRANCA (modal "+ Contratar" da ficha) |
| `produto` (itens avulsos de contrato) | PRODUTOS | `GET produtos` + COMERCIAL (carrinho de itens da proposta) |
| `aprovacao` | APROVACOES | — (quem decide continua sendo a alçada, no service) |
| `alcada` | APROVACOES, CONFIGURACOES (leitura) | `PUT alcadas`, `POST/PUT alcadas/operacoes…` → CONFIGURACOES |
| `simulador` (parâmetros, ofertas fixas) | CONFIGURACOES | `GET simulador/ofertas-fixas` + ATIVOS_FROTA (tela de ativos mostra a oferta vinculada) |
| `usuarios`, `permissoes/matriz` | CONFIGURACOES | `GET me/areas`, `GET/PUT me/preferencias` `@AreaLivre` |
| `integracoes` | CONFIGURACOES | — |
| `auth`, `notificacao`, `inicio` | `@AreaLivre` | sessão, sino e fila de trabalho do próprio usuário |
| `health`, `webhooks/*`, `mcp` | `@Public` (fora do JWT) | autenticação própria (§7.4); `/publico` da Fatura Azit ainda não está nesta branch |

**Rotas da tela (`router.tsx`, `handle.area`)** — mesmo mapa: `/atendimento`, `/simulacoes`, `/propostas(/:id)`,
`/lista-espera` → COMERCIAL · `/analises(/:id)` → ANALISE_CADASTRO · `/carteira`, `/carteira/clientes`, `/regua`,
`/acordos`, `/migracao-legado(/:id)` → CARTEIRA_COBRANCA · `/contratos/:id` → `AREAS_CONTRATO` · `/titulares`,
`/pessoas` → PESSOAS · `/titulares/:id` → `AREAS_FICHA_TITULAR` · `/contas-a-pagar`, `/fornecedores-financeiro`,
`/financeiro-configuracao` → FINANCEIRO_ADMINISTRATIVO · `/ativos`, `/frota/ocorrencias` → ATIVOS_FROTA ·
`/centros-custo` → ATIVOS_FROTA ou FINANCEIRO_ADMINISTRATIVO · `/estruturas` → CAPITAL_INVESTIMENTO · `/produtos`,
`/catalogo`, `/protecao` → PRODUTOS · `/aprovacoes(/:id)` → APROVACOES · `/configuracoes/*` → CONFIGURACOES ·
`/` (Início) e `/login` sem área.

### 13.2 Divergências em relação ao mapa inicial (decididas pelo uso real; a confirmar com o Luís)

1. **`dossie` não é análise.** O mapa inicial o punha em ANALISE_CADASTRO; o módulo é o dossiê para judicialização do contrato (doc 02 §30), gerado no detalhe do contrato, e os documentos da empresa (contrato social) são Configuração. Classificado assim.
2. **Não existe tela nem item de menu "Contratos".** O detalhe do contrato é aberto a partir da carteira (régua, acordos, clientes, migração), do funil (formalização → contrato) e da ficha. Por isso toda leitura de contrato — e também `cancelar` e `transferencia-efetivada` — ficou em `AREAS_CONTRATO` (CONTRATOS, CARTEIRA_COBRANCA, COMERCIAL). A área CONTRATOS continua na matriz como "dona" (é a primeira), mas hoje ninguém precisa dela sozinha. **Decisão pendente:** criar o item de menu "Contratos" (lista de contratos) ou absorver a área em Carteira e cobrança.
3. **`centro-custo`** estava só em FINANCEIRO_ADMINISTRATIVO; a tela "Custo por ativo" fica no grupo Ativos e frota. Ficou com as duas.
4. **`capital` tem duas telas de áreas diferentes:** Pessoas (`/pessoas`, classificação de investidor/fornecedor/parceiro) e Estruturas jurídicas (Capital). As rotas de pessoas/classificações receberam PESSOAS; estruturas ficaram em Capital.
5. **`fipe`**: o §13 inicial dizia COMERCIAL e o §5.4 item 6 dizia "apoio". Prevaleceu o §5.4 (`@AreaLivre`): é tabela pública de referência, não dado do negócio.
6. **"`catalogo` de parâmetros → CONFIGURACOES" não existe como módulo separado**: o catálogo inteiro (produto, variante, versão) fica em PRODUTOS, onde está a tela. A configuração do simulador (parâmetros versionados, ofertas fixas) é CONFIGURACOES, como previsto.
7. **Escrita compartilhada em dois pontos**, contra a regra "escrita só da área dona", porque a tela da outra área depende dela: `POST /financeiro/fornecedores` (a ficha cadastra o fornecedor ao contratar Reembolso Parcelado) e `POST /propostas/:id/analise` (a proposta abre a análise). Anotado; se o Luís preferir, viram botões desabilitados para quem não tem a área dona.
8. **`credito`** (crédito avulso) não constava no mapa; é operado na ficha do titular → COMERCIAL, PESSOAS, CARTEIRA_COBRANCA.
9. **Carteira → ficha do titular é link entre áreas** (a ficha é PESSOAS/COMERCIAL, como a linha `titular` do mapa). Quem só tem Carteira e cobrança vê o nome do cliente sem link (com o motivo) em Carteira, Clientes da carteira, Conferência Asaas, Régua, Renegociações e Contas a pagar. As leituras que a ficha faz na carteira (faturas, lançamentos, régua, elegibilidade) foram abertas a PESSOAS/COMERCIAL; as **ações** de carteira dentro da ficha (gerar cobrança, conferir pagamento, bloquear, renegociar) continuam exigindo CARTEIRA_COBRANCA e respondem 403 com a área. **Decisão pendente:** se a ficha deve ser também de Carteira e cobrança (hoje é o hub de operações da conta).

### 13.3 Matriz padrão e risco de auto-bloqueio

- **Matriz padrão (placeholder, Regra 12).** A matriz papel × área nunca foi semeada: em banco novo ninguém teria área nenhuma e, com a área valendo como autorização, nem o Admin entraria. O seed passou a semear um padrão provisório **só quando a matriz está vazia** (nunca sobrescreve a matriz editada pelo Admin em produção): ADMIN e DIRETOR com todas; APROVADOR com Aprovações, Análise de cadastro, Comercial, Contratos, Carteira; OPERADOR com Comercial, Contratos, Carteira, Pessoas, Ativos e frota, Produtos (**sem** Análise de cadastro — o analista recebe por exceção, como em produção); FINANCEIRO com Financeiro administrativo, Carteira, Contratos, Pessoas. Editável na tela Usuários e permissões.
- **Auto-bloqueio — APLICADO no bloco 2 (13/11/2026).** Como decidido no §7.5, ADMIN não é curinga: se o Admin retirar CONFIGURACOES de si mesmo (pela matriz do papel ADMIN ou por exceção), perde a tela Usuários e permissões e ninguém mais consegue devolver a área pela interface. A regra "o sistema nunca fica sem administrador ativo" (`exigirOutroAdmin`) foi espelhada em **"nunca fica sem administrador ativo com a área Configurações"**: `PermissoesService.exigirAdminComConfiguracoes` carrega usuários + matriz, aplica a mutação pretendida numa cópia (conta pura `haAdminComConfiguracoes`) e, se depois dela não sobrar administrador ativo, não excluído, com CONFIGURACOES efetiva, responde `422 { erro: 'sem_admin_configuracoes' }` com a mensagem "conceda a área (ou o papel) a outro usuário antes". Cobre: célula da matriz (`PUT /permissoes/matriz`), exceção por usuário (`PUT /usuarios/:id/permissoes`), papéis e `ativo` (`PATCH /usuarios/:id`) e exclusão (`DELETE /usuarios/:id`). A guarda antiga por papel (`ultimo_admin`, 400) continua valendo — a nova é mais estrita (papel + área). Decisão aplicada como proposta no doc; o Luís confirma no homolog.

---

### Histórico de versões

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | jun/2025 | Documento original: dois mundos de identidade, tokens, RBAC, alçadas, guards, titular (desenho) |
| 1.1 | 12/11/2026 | Entrar com Google (dois domínios), senha opcional por usuário, limite de tentativas e registro de acessos (§2, §10, §11.3); área de trabalho como autorização na API e na tela, `AreaGuard` e mapa módulo → área (§5.4, §7.5, §13); alertas por e-mail sobre notificações dirigidas (§12); ordem dos blocos (§11.6). Decisões Luís. |
| 1.1.1 | 13/11/2026 | Bloco 1 aplicado: §13 passa a ser o mapa EM VIGOR (13.1), com as divergências do mapa inicial (13.2), a matriz padrão do seed e o risco de auto-bloqueio (13.3); formato do 403 com `mensagem` (§7.5). Aguarda homolog. |
| 1.1.2 | 13/11/2026 | Bloco 2 aplicado (mesma branch): entrar com Google, senha de reserva por usuário, limite por IP, bloqueio temporário, registro de acessos com telas (Usuários e permissões, Minha conta, Integrações), auto-bloqueio do §13.3. Escolhas e divergências anotadas na §2.5 (nota), §9 (`emailTentado` opcional), §10.3 (REFRESH só em falha), §11.6. Aguarda homolog. |

*Doc 6 — Autenticação e Permissões · Azit Move V3 · v1.1 · nov/2026*
*Documentos relacionados: Doc 2 — Spec de Domínio · Doc 4 — Setup · Doc 5 — Prisma Schema*
