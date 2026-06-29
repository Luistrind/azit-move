# Doc 6 — Autenticação e Permissões
## Azit Move V3

**Versão:** 1.0  
**Data:** jun/2025  
**Status:** Aprovado para implementação (V1: autenticação interna; titular: desenhada, implementação futura)

---

## Sumário

1. Visão geral — dois mundos de identidade
2. Autenticação do Usuário interno
3. Estratégia de tokens
4. Payload do JWT
5. Roles e RBAC
6. Alçadas de aprovação
7. Guards e proteção de rotas
8. Autenticação do Titular (desenho — implementação futura)
9. Modelos de dados
10. Fluxos de autenticação
11. Notas de implementação e segurança

---

## 1. Visão geral — dois mundos de identidade

O sistema tem **dois mecanismos de identidade distintos**, cada um único no seu mundo. Não se misturam e não compartilham credenciais.

| Mundo | Quem | Como autentica | Acessa |
|---|---|---|---|
| **Interno** | Funcionário (Usuario) | email + senha | Console operacional |
| **Externo** | Pessoa (Titular) | identidade própria (futura) | A própria conta |

**Usuario interno** acessa o console operacional. Tem múltiplos roles que se somam (RBAC). É o foco da implementação do V1.

**Titular externo** autentica uma vez e acessa **a própria conta**. Dentro da conta, vê os módulos correspondentes ao que possui — módulo cliente se tem ContratoCredito, módulo investidor se tem ContratoInvestimento, ambos se tem os dois. Não são logins separados: é um login, uma conta, módulos condicionais. A estrutura é desenhada desde já (seção 8), mas a implementação é fase futura, junto com as telas desses módulos (marcadas como fora do V1 no Doc 3).

> **Princípio:** o titular não tem "tipo de login". O que ele vê é derivado do que a conta possui, nunca de uma classificação do acesso. Espelha o app do banco: você entra uma vez e vê crédito e investimentos como abas da mesma conta.

---

## 2. Autenticação do Usuário interno

O Usuario representa um funcionário da Azit (operação, financeiro, direção). Autentica com **email + senha**.

### 2.1 Credenciais

- **Identificador:** email (único no sistema)
- **Senha:** armazenada como hash, nunca em texto puro
- **Algoritmo de hash:** bcrypt com cost factor 12 (ou argon2id, se disponível no ambiente)
- O campo no banco é `senhaHash` — o nome reforça que nunca se guarda a senha em si

### 2.2 Fluxo de login

1. Usuário envia email + senha para `POST /api/v1/auth/login`
2. Sistema busca o usuário pelo email
3. Compara a senha com o hash armazenado (bcrypt.compare)
4. Se válido e o usuário está ativo: gera access token + refresh token
5. Retorna ambos ao cliente
6. Se inválido: resposta genérica `401` sem revelar se foi email ou senha que falhou

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

Rotas públicas no V1: `POST /auth/login`, `POST /auth/refresh`, e o webhook do Asaas (que usa validação de assinatura própria, não JWT).

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
  senhaHash     String
  ativo         Boolean       @default(true)
  roles         UsuarioRole[]
  refreshTokens RefreshToken[]
  // ...
}

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

### 10.1 Login interno

```
POST /api/v1/auth/login
  body: { email, senha }
  → valida credenciais
  → gera access token (15min) + refresh token (7d)
  → persiste refresh token no banco
  → retorna { accessToken, refreshToken, usuario: { id, nome, roles } }
```

### 10.2 Requisição autenticada

```
GET /api/v1/contratos-credito
  header: Authorization: Bearer <access_token>
  → JwtAuthGuard valida o token
  → popula request.user = { id, roles }
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

- **Rate limiting** no endpoint de login (evitar brute force) — sugestão: 5 tentativas por minuto por IP
- **Resposta genérica** em falha de login — não revelar se email existe ou se foi a senha
- **HTTPS obrigatório** em produção — tokens nunca trafegam em texto claro
- **CORS** restrito ao domínio do frontend (já configurado no `main.ts` do Doc 4)

### 11.4 Revogação e logout

- Logout revoga o refresh token (`revogado = true`)
- Em caso de comprometimento de conta, revogar todos os refresh tokens daquele usuário força novo login em todos os dispositivos
- O access token não é revogável — a duração de 15 min é a mitigação

### 11.5 Escopo do V1

| Item | V1 |
|---|---|
| Autenticação Usuario interno (login, refresh, logout) | ✅ Implementar |
| RBAC com múltiplos roles | ✅ Implementar |
| Guards (JwtAuthGuard, RolesGuard) | ✅ Implementar |
| Estrutura de alçada configurável | ⏳ Esqueleto; regras com Vicente |
| Autenticação do Titular | 📐 Desenhada; implementação futura |
| Telas dos módulos cliente/investidor | 📐 Fora do V1 (Doc 3) |

---

*Doc 6 — Autenticação e Permissões · Azit Move V3 · v1.0 · jun/2025*
*Documentos relacionados: Doc 2 — Spec de Domínio · Doc 4 — Setup · Doc 5 — Prisma Schema*
