# Deploy — Azit Move V3 (EasyPanel / Ubuntu Hostinger)

Guia para publicar o backend (NestJS), o frontend (Vite SPA), o Postgres e o Redis
no EasyPanel. Depois disso, tudo roda no servidor — sem dependência da sua máquina,
sem túnel, com **URL fixa** para o webhook do Asaas.

> Pré-requisito: o repositório precisa estar no **GitHub** (veja a seção final).

---

## 1. Criar o projeto e os serviços gerenciados

No EasyPanel, crie um **Project** (ex.: `azit`) e dentro dele:

### 1.1 Postgres (template)
- Crie um serviço **Postgres** (aba Templates → Postgres). Anote **usuário, senha,
  database e o host interno** que o EasyPanel mostra (algo como `azit_postgres`).
- A connection string interna fica:
  `postgresql://USUARIO:SENHA@HOST_INTERNO:5432/DATABASE?schema=public`

### 1.2 Redis (template)
- Crie um serviço **Redis**. Anote o host interno (ex.: `azit_redis`) e a senha (se houver).
- URL interna: `redis://HOST_INTERNO:6379` (ou `redis://:SENHA@HOST_INTERNO:6379`).

> Serviços do mesmo Project se enxergam pelo **host interno** (rede Docker do EasyPanel).
> É isso que elimina o `P1001` e a instabilidade do Docker local.

---

## 2. Backend (App a partir do GitHub)

Crie um **App** → Source: seu repo GitHub, branch `main`.

**Build**
- Método: **Dockerfile**
- Build context / raiz: `/`  (raiz do repositório — é um monorepo)
- Dockerfile path: `apps/backend/Dockerfile`

**Porta / Domínio**
- Porta interna do container: `3001`
- Adicione um **Domínio** (ex.: `api.seu-dominio.com` ou o subdomínio `*.easypanel.host`).
  O EasyPanel provisiona HTTPS automático (Let's Encrypt).

**Environment** (Variáveis) — cole os valores reais:
```
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://SEU-FRONTEND            # domínio do app frontend (CORS)
DATABASE_URL=postgresql://USUARIO:SENHA@HOST_INTERNO:5432/DATABASE?schema=public
REDIS_URL=redis://HOST_INTERNO:6379
JWT_SECRET=<gere um segredo forte, ex: openssl rand -hex 32>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN_DAYS=7
ASAAS_API_URL=https://api-sandbox.asaas.com/v3
ASAAS_API_KEY=<sua chave sandbox>
ASAAS_WEBHOOK_SECRET=<token do webhook — o MESMO configurado no painel do Asaas>
```
> As `migrations` rodam sozinhas no start (o container executa `prisma migrate deploy`
> antes de subir). Não precisa rodar nada à mão.

**Seed (opcional, 1ª vez)** — para ter o usuário admin e catálogos:
- No EasyPanel, abra o **Console/Terminal** do container do backend e rode:
  `pnpm exec ts-node prisma/seed.ts`
  (ou deixe sem seed e crie os dados pela própria UI).

---

## 3. Frontend (App a partir do GitHub)

Crie outro **App** → mesmo repo GitHub, branch `main`.

**Build**
- Método: **Dockerfile**
- Build context / raiz: `/`
- Dockerfile path: `apps/frontend/Dockerfile`
- **Build Arg**: `VITE_API_URL = https://SEU-BACKEND`  (o domínio do app backend, SEM `/api/v1`)
  > O Vite inlina isso no bundle em build time — se mudar o domínio do backend, rebuild.

**Porta / Domínio**
- Porta interna: `80`
- Adicione o domínio do frontend (o mesmo que você pôs em `FRONTEND_URL` do backend).

---

## 4. Ligar o Asaas ao servidor (uma vez só)

No painel do Asaas → **Webhooks**:
- **URL**: `https://SEU-BACKEND/api/v1/webhooks/asaas`
- **Token de autenticação**: o MESMO valor de `ASAAS_WEBHOOK_SECRET`.
- Versão **v3**, envio **Sequencial**, eventos de **Cobranças**:
  `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`.
- Deixe a **Fila de sincronização** ativada.

Como a URL agora é fixa, você **não precisa mais reconfigurar** a cada reinício.

---

## 5. Checklist pós-deploy
- [ ] Backend responde em `https://SEU-BACKEND/api/v1/health` (ou `/auth/login`).
- [ ] Frontend abre e faz login (usa `VITE_API_URL`).
- [ ] `DATABASE_URL`/`REDIS_URL` apontam para os **hosts internos** dos serviços.
- [ ] Webhook do Asaas aponta para o backend e o **token bate** com `ASAAS_WEBHOOK_SECRET`.
- [ ] Um pagamento de teste no sandbox → webhook chega → contrato ativa.

## 6. Observações
- **CORS**: `FRONTEND_URL` deve ser exatamente o domínio do frontend (com https), senão o
  navegador bloqueia as chamadas.
- **Redeploy**: a cada push no branch `main`, o EasyPanel pode rebuildar (auto-deploy) se
  você ligar essa opção.
- **Produção real (futuro)**: troque `ASAAS_API_URL` para `https://api.asaas.com/v3` e a
  `ASAAS_API_KEY` para a de produção. O resto do fluxo é idêntico.
