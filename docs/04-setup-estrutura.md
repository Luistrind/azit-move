# Doc 4 — Setup e Estrutura do Projeto
## Azit Move V3

**Versão:** 1.0  
**Data:** jun/2025  
**Status:** Aprovado para início do desenvolvimento

---

## Sumário

1. Stack tecnológica
2. Estrutura do monorepo
3. Configuração do workspace
4. Backend — estrutura e convenções
5. Frontend — estrutura e convenções
6. Pacotes compartilhados
7. Banco de dados
8. Filas e processamento assíncrono
9. Variáveis de ambiente
10. Scripts de desenvolvimento
11. Convenções de código
12. Ordem de inicialização do projeto

---

## 1. Stack tecnológica

### Decisões e justificativas

| Camada | Tecnologia | Versão | Justificativa |
|---|---|---|---|
| Runtime | Node.js | 20.x LTS | LTS estável, suporte nativo a ESM |
| Package manager | pnpm | 9.x | Workspaces nativos, eficiente em disco |
| Linguagem | TypeScript | 5.x | Obrigatório em todo o monorepo |
| Backend framework | NestJS | 11.x | Módulos por domínio, DI nativa, testabilidade |
| HTTP adapter | Fastify | 4.x | Substitui Express; mais rápido, adequado para volume de webhooks |
| ORM | Prisma | 5.x | Type-safe, migrations automáticas, cliente gerado |
| Banco de dados | PostgreSQL | 16.x | Banco relacional compatível com o modelo financeiro |
| Filas | BullMQ | 5.x | Processamento assíncrono de webhooks via Redis |
| Cache / Broker | Redis | 7.x | Requerido pelo BullMQ |
| Validação (backend) | Zod | 3.x | Validação de DTOs e payloads externos |
| Frontend framework | React | 18.x | SPA sem SSR — console interno autenticado |
| Build tool | Vite | 5.x | Substitui Next.js; mais simples para SPA puro |
| Roteamento | React Router | 6.x | Roteamento client-side |
| Dados do servidor | TanStack Query | 5.x | Cache, loading states, invalidação automática |
| Estado global | Zustand | 4.x | State management mínimo para UI state |
| Estilos | Tailwind CSS | 3.x | Utility-first, alinhado com os tokens do Doc 3 |
| Ícones | Lucide React | latest | Biblioteca limpa, alinhada ao estilo do sistema |
| Datas | date-fns | 3.x | Formatação e manipulação de datas |
| HTTP client | Axios | 1.x | Chamadas para o NestJS e para o Asaas |

---

## 2. Estrutura do monorepo

```
azit-v3/
├── apps/
│   ├── backend/                  ← NestJS + Fastify
│   └── frontend/                 ← React + Vite
├── packages/
│   ├── types/                    ← interfaces TypeScript compartilhadas
│   └── utils/                    ← helpers compartilhados (formatação, cálculos)
├── .gitignore
├── .npmrc
├── pnpm-workspace.yaml
├── package.json                  ← scripts globais e devDependencies do root
└── tsconfig.base.json            ← tsconfig base estendido por todos os apps
```

---

## 3. Configuração do workspace

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### package.json (root)

```json
{
  "name": "azit-v3",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel --filter './apps/*' dev",
    "dev:backend": "pnpm --filter backend dev",
    "dev:frontend": "pnpm --filter frontend dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "db:migrate": "pnpm --filter backend db:migrate",
    "db:migrate:dev": "pnpm --filter backend db:migrate:dev",
    "db:studio": "pnpm --filter backend db:studio",
    "db:seed": "pnpm --filter backend db:seed",
    "db:reset": "pnpm --filter backend db:reset"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### .npmrc

```
shamefully-hoist=false
strict-peer-dependencies=false
```

### tsconfig.base.json (root)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### .gitignore (root)

```
node_modules/
dist/
build/
.env
.env.local
*.log
.DS_Store
coverage/
```

---

## 4. Backend — estrutura e convenções

### 4.1 Estrutura de pastas

```
apps/backend/
├── src/
│   ├── main.ts                   ← bootstrap com Fastify
│   ├── app.module.ts             ← módulo raiz
│   ├── modules/                  ← um módulo por domínio
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   └── jwt.strategy.ts
│   │   │   └── dto/
│   │   │       └── login.dto.ts
│   │   ├── titulares/
│   │   │   ├── titulares.module.ts
│   │   │   ├── titulares.controller.ts
│   │   │   ├── titulares.service.ts
│   │   │   └── dto/
│   │   │       ├── create-titular.dto.ts
│   │   │       └── update-titular.dto.ts
│   │   ├── contas/
│   │   ├── ativos/
│   │   ├── contratos-credito/
│   │   ├── contratos-investimento/
│   │   ├── itens-contratados/
│   │   ├── faturas/
│   │   ├── parcelas/
│   │   ├── recebiveis/
│   │   ├── acordos/
│   │   ├── origens-capital/
│   │   ├── regua/                ← lógica da régua de cobrança
│   │   ├── webhooks/             ← recepção de webhooks do Asaas
│   │   │   ├── webhooks.module.ts
│   │   │   ├── webhooks.controller.ts
│   │   │   └── webhooks.service.ts
│   │   └── queues/               ← definição e processadores das filas
│   │       ├── queues.module.ts
│   │       ├── processors/
│   │       │   ├── pagamento.processor.ts
│   │       │   └── regua.processor.ts
│   │       └── jobs/
│   │           ├── fechar-fatura.job.ts
│   │           └── gerar-cobranca.job.ts
│   ├── common/                   ← utilitários transversais
│   │   ├── decorators/
│   │   │   └── current-user.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts
│   │   └── pipes/
│   │       └── zod-validation.pipe.ts
│   ├── config/
│   │   ├── config.module.ts
│   │   └── configuration.ts      ← mapeamento de variáveis de ambiente
│   └── database/
│       └── prisma.service.ts     ← PrismaClient como NestJS service
├── prisma/
│   ├── schema.prisma             ← ver Doc 5
│   ├── migrations/
│   └── seed.ts
├── test/
│   └── app.e2e-spec.ts
├── .env.example
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
└── package.json
```

### 4.2 main.ts

```typescript
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const frontendUrl = configService.get<string>('FRONTEND_URL');

  app.enableCors({ origin: frontendUrl, credentials: true });
  app.setGlobalPrefix('api/v1');

  await app.listen(port, '0.0.0.0');
  console.log(`Backend rodando em http://localhost:${port}`);
}

bootstrap();
```

### 4.3 Estrutura interna de um módulo

Padrão a seguir em todos os módulos de domínio:

```
modules/contratos/
├── contratos.module.ts
├── contratos.controller.ts       ← HTTP, sem lógica de negócio
├── contratos.service.ts          ← lógica de negócio
└── dto/
    ├── create-contrato.dto.ts    ← validação com Zod
    ├── update-contrato.dto.ts
    └── contrato-response.dto.ts  ← shape da resposta
```

**Controller:** recebe a requisição, chama o service, retorna a resposta. Sem lógica.

**Service:** contém toda a lógica de negócio. Chama o Prisma diretamente (não há repository layer adicional — o PrismaService é o repository).

**DTO:** usa Zod para validação, com o pipe `ZodValidationPipe` global.

### 4.4 package.json (backend)

```json
{
  "name": "backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "db:migrate": "prisma migrate deploy",
    "db:migrate:dev": "prisma migrate dev",
    "db:studio": "prisma studio",
    "db:seed": "ts-node prisma/seed.ts",
    "db:reset": "prisma migrate reset"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/platform-fastify": "^11.0.0",
    "@nestjs/bullmq": "^10.0.0",
    "bullmq": "^5.0.0",
    "@prisma/client": "^5.0.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.0",
    "ioredis": "^5.0.0",
    "axios": "^1.0.0",
    "zod": "^3.0.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.0.0",
    "@azit/types": "workspace:*",
    "@azit/utils": "workspace:*"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/node": "^20.0.0",
    "@types/passport-jwt": "^4.0.0",
    "prisma": "^5.0.0",
    "ts-node": "^10.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  }
}
```

### 4.5 nest-cli.json

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

---

## 5. Frontend — estrutura e convenções

### 5.1 Estrutura de pastas

```
apps/frontend/
├── src/
│   ├── main.tsx                  ← entry point
│   ├── App.tsx                   ← providers e router
│   ├── router.tsx                ← definição de rotas
│   ├── pages/                    ← uma pasta por módulo de acesso (não por entidade)
│   │   ├── auth/
│   │   │   └── LoginPage.tsx
│   │   ├── operacao/
│   │   │   ├── CarteiraPage.tsx
│   │   │   ├── ContratoDetailPage.tsx
│   │   │   ├── ReguaPage.tsx
│   │   │   └── AcordosPage.tsx
│   │   ├── cliente/              ← módulo que o titular acessa quando tem ContratoCredito
│   │   │   └── ContaPage.tsx
│   │   └── investidor/          ← módulo que o titular acessa quando tem ContratoInvestimento
│   │       ├── AtivoPage.tsx
│   │       └── FundoPage.tsx
│   ├── components/
│   │   ├── ui/                   ← componentes genéricos (sem lógica de domínio)
│   │   │   ├── Badge.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── EntityHeader.tsx
│   │   │   ├── KanbanBoard.tsx
│   │   │   ├── KanbanColumn.tsx
│   │   │   ├── KanbanCard.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── Table.tsx
│   │   │   ├── Tabs.tsx
│   │   │   └── index.ts          ← re-export de todos os ui components
│   │   ├── layout/
│   │   │   ├── Shell.tsx         ← wrapper geral (sidebar + topbar + scroll area)
│   │   │   ├── Sidebar.tsx
│   │   │   └── Topbar.tsx
│   │   └── features/             ← componentes com lógica de domínio
│   │       ├── contratos/
│   │       │   ├── ContratoRow.tsx
│   │       │   └── ContratoCard.tsx
│   │       ├── faturas/
│   │       │   └── FaturaRow.tsx
│   │       └── acordos/
│   │           └── AcordoModal.tsx
│   ├── hooks/                    ← custom hooks (prefixo use)
│   │   ├── useContratos.ts
│   │   ├── useFaturas.ts
│   │   └── useAuth.ts
│   ├── services/                 ← funções de chamada à API
│   │   ├── contratos.service.ts
│   │   ├── faturas.service.ts
│   │   └── acordos.service.ts
│   ├── stores/                   ← Zustand stores para UI state
│   │   └── authStore.ts
│   ├── lib/
│   │   ├── api.ts                ← instância axios configurada
│   │   └── queryClient.ts        ← instância TanStack Query
│   ├── config/
│   │   └── statusColors.ts       ← mapeamento status → cores (seção 4 do Doc 3)
│   └── types/                    ← re-exports de @azit/types
│       └── index.ts
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
└── package.json
```

### 5.2 Configuração crítica: statusColors.ts

Este arquivo centraliza o mapeamento entre status de domínio e cores visuais, conforme a seção 4 do Doc 3. **Nunca hardcodar cores de status em componentes individuais** — sempre importar daqui.

```typescript
// src/config/statusColors.ts

export type StatusColor = {
  bg: string;
  fg: string;
};

export const PARCELA_STATUS_COLORS: Record<string, StatusColor> = {
  'Em aberto':       { bg: '#f1f4f8', fg: '#8694a4' },
  'Vence hoje':      { bg: '#fef6e9', fg: '#c98a0a' },
  'Vencida':         { bg: '#fef6e9', fg: '#c98a0a' },
  'Paga':            { bg: '#eafaf1', fg: '#1f9d5b' },
  'Paga em atraso':  { bg: '#eafaf1', fg: '#1f9d5b' },
  'Paga antecipada': { bg: '#eafaf1', fg: '#1f9d5b' },
  'Renegociada':     { bg: '#efeaff', fg: '#6b4fd6' },
  'Cancelada':       { bg: '#fdeceb', fg: '#e0413c' },
  'Estornada':       { bg: '#fdeceb', fg: '#e0413c' },
  'Suspensa':        { bg: '#f1f4f8', fg: '#9aa7b5' },
};

export const FATURA_STATUS_COLORS: Record<string, StatusColor> = {
  'Aberta':          { bg: '#f1f4f8', fg: '#8694a4' },
  'Fechada':         { bg: '#eef1f5', fg: '#5b6b7f' },
  'Vencida':         { bg: '#fef6e9', fg: '#c98a0a' },
  'Paga':            { bg: '#eafaf1', fg: '#1f9d5b' },
  'Paga em atraso':  { bg: '#eafaf1', fg: '#1f9d5b' },
  'Renegociada':     { bg: '#efeaff', fg: '#6b4fd6' },
};

export const CONTRATO_STATUS_COLORS: Record<string, StatusColor> = {
  'Rascunho':                        { bg: '#f1f4f8', fg: '#8694a4' },
  'Aguardando assinatura':           { bg: '#f1f4f8', fg: '#8694a4' },
  'Aguardando pagamento inicial':    { bg: '#fef6e9', fg: '#c98a0a' },
  'Aguardando entrega do veículo':   { bg: '#fef6e9', fg: '#c98a0a' },
  'Ativo':                           { bg: '#eafaf1', fg: '#1f9d5b' },
  'Inadimplente':                    { bg: '#fef6e9', fg: '#c98a0a' },
  'Bloqueado':                       { bg: '#fdeceb', fg: '#e0413c' },
  'Suspenso':                        { bg: '#f1f4f8', fg: '#9aa7b5' },
  'Em recuperação de veículo':       { bg: '#f3eafb', fg: '#9a3bd1' },
  'Cancelado':                       { bg: '#fdeceb', fg: '#e0413c' },
  'Rescindido':                      { bg: '#f1f4f8', fg: '#5b6b7f' },
  'Quitado (aguardando transferência)':   { bg: '#eafaf1', fg: '#1f9d5b' },
  'Quitado (transferência efetivada)':    { bg: '#eafaf1', fg: '#1f9d5b' },
};

export const ACORDO_STATUS_COLORS: Record<string, StatusColor> = {
  'Rascunho':  { bg: '#f1f4f8', fg: '#8694a4' },
  'Ativo':     { bg: '#fef6e9', fg: '#c98a0a' },
  'Quitado':   { bg: '#eafaf1', fg: '#1f9d5b' },
  'Cancelado': { bg: '#fdeceb', fg: '#e0413c' },
};

export const REGUA_STAGE_COLORS: Record<string, string> = {
  'D+1':  '#e8920c',
  'D+2':  '#e07a0c',
  'D+3':  '#e0413c',
  'D+10': '#9a3bd1',
  'D+12': '#5b6b7f',
};
```

### 5.3 lib/api.ts

```typescript
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

// Interceptor: injeta token JWT em todas as requisições
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('azit_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor: redireciona para login em 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('azit_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
```

### 5.4 vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@azit/types': path.resolve(__dirname, '../../packages/types/src'),
      '@azit/utils': path.resolve(__dirname, '../../packages/utils/src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

### 5.5 tailwind.config.ts

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy:    '#001029',
        accent:  '#FA8E0D',
        'app-bg': '#eef1f5',
      },
      fontFamily: {
        display: ['Outfit', 'system-ui', 'sans-serif'],
        body:    ['Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card:  '14px',
        modal: '18px',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### 5.6 package.json (frontend)

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.0.0",
    "axios": "^1.0.0",
    "zod": "^3.0.0",
    "lucide-react": "latest",
    "date-fns": "^3.0.0",
    "clsx": "^2.0.0",
    "@azit/types": "workspace:*",
    "@azit/utils": "workspace:*"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.0.0",
    "postcss": "^8.0.0",
    "autoprefixer": "^10.0.0"
  }
}
```

---

## 6. Pacotes compartilhados

### 6.1 @azit/types

Interfaces TypeScript usadas pelo backend e frontend. Não contém lógica — apenas tipos.

```
packages/types/
├── src/
│   ├── index.ts                  ← re-export geral
│   ├── entities/
│   │   ├── titular.ts
│   │   ├── conta.ts
│   │   ├── ativo.ts
│   │   ├── contrato-credito.ts
│   │   ├── contrato-investimento.ts
│   │   ├── origem-capital.ts
│   │   ├── item-contratado.ts
│   │   ├── fatura.ts
│   │   ├── parcela.ts
│   │   ├── recebivel.ts
│   │   └── acordo.ts
│   └── enums/
│       ├── status-parcela.ts
│       ├── status-fatura.ts
│       ├── status-contrato-credito.ts
│       ├── status-contrato-investimento.ts
│       ├── status-acordo.ts
│       ├── modelo-investimento.ts
│       ├── origem-capital.ts
│       └── origem-item-contratado.ts
├── tsconfig.json
└── package.json
```

**package.json:**
```json
{
  "name": "@azit/types",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

**Exemplo — enums/status-parcela.ts:**
```typescript
export enum StatusParcela {
  EM_ABERTO       = 'Em aberto',
  VENCE_HOJE      = 'Vence hoje',
  VENCIDA         = 'Vencida',
  PAGA            = 'Paga',
  PAGA_EM_ATRASO  = 'Paga em atraso',
  PAGA_ANTECIPADA = 'Paga antecipada',
  RENEGOCIADA     = 'Renegociada',
  CANCELADA       = 'Cancelada',
  ESTORNADA       = 'Estornada',
  SUSPENSA        = 'Suspensa',
}
```

> **Nota:** os três primeiros valores (Em aberto, Vence hoje, Vencida) existem no enum para tipagem do estado exibido, mas não são persistidos no banco — são calculados em runtime pela função `resolverStatusParcela` em `@azit/utils` (ver Doc 5, seção 11.2). O enum equivalente no Prisma contém apenas os estados armazenáveis.

**Exemplo — enums/origem-item-contratado.ts:**
```typescript
export enum OrigemItemContratado {
  VENDA  = 'venda',   // produto vendido (veículo, proteção, crédito avulso)
  ACORDO = 'acordo',  // crédito gerado por um Acordo (dilui parcelas; NÃO liquida o contrato)
}
```

> **Nota:** os status calculados (Em aberto, Vence hoje, Vencida) existem como enum para tipagem — mas não são armazenados no banco. O backend os calcula em runtime comparando a data de vencimento com `Date.now()`.

### 6.2 @azit/utils

Funções puras compartilhadas. Não tem estado, não faz chamadas de rede.

```
packages/utils/
├── src/
│   ├── index.ts
│   ├── formatters.ts             ← moeda, datas, CPF, placa
│   └── calculations.ts           ← fórmula VP de quitação antecipada
├── tsconfig.json
└── package.json
```

**calculations.ts:**
```typescript
/**
 * Calcula o valor presente de uma parcela futura para quitação antecipada.
 * Fórmula validada com Vicente em 23/06/2025.
 *
 * VP = VF / (1 + taxa)^tempo
 *
 * @param vf    Valor futuro da parcela
 * @param taxa  Taxa diária parametrizável (ex: 0.001 = 0.1% ao dia)
 * @param tempo Número de dias entre hoje e o vencimento
 */
export function calcularValorPresente(
  vf: number,
  taxa: number,
  tempo: number,
): number {
  return vf / Math.pow(1 + taxa, tempo);
}

/**
 * Calcula o total de quitação antecipada para um conjunto de parcelas.
 */
export function calcularQuitacaoTotal(
  parcelas: Array<{ valorFuturo: number; diasAteVencimento: number }>,
  taxa: number,
): number {
  return parcelas.reduce(
    (acc, p) => acc + calcularValorPresente(p.valorFuturo, taxa, p.diasAteVencimento),
    0,
  );
}
```

**formatters.ts:**
```typescript
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR });
}

export function formatCPF(cpf: string): string {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function formatParcela(atual: number, total: number): string {
  return `${atual}/${total}`;
}
```

---

## 7. Banco de dados

### 7.1 Localização do schema

```
apps/backend/prisma/schema.prisma
```

O schema completo é definido no **Doc 5 — Prisma Schema**. Este documento apenas define a infraestrutura de acesso.

### 7.2 PrismaService (NestJS)

```typescript
// src/database/prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

O `PrismaService` é exportado de um `DatabaseModule` e importado nos módulos que precisam de acesso ao banco.

### 7.3 Configuração de banco local

```sql
-- Para desenvolvimento local
CREATE DATABASE azit_v3;
CREATE USER azit_user WITH PASSWORD 'senha_local';
GRANT ALL PRIVILEGES ON DATABASE azit_v3 TO azit_user;
```

### 7.4 Seed

O arquivo `prisma/seed.ts` deve criar:
- Um usuário operador de teste
- Um ativo de exemplo
- Um contrato de exemplo com parcelas geradas

---

## 8. Filas e processamento assíncrono

### 8.1 Por que filas são obrigatórias

O Asaas exige resposta em milissegundos ao enviar um webhook. A lógica de conciliação de pagamento (baixar fatura, recalcular posição na régua, calcular breakdown de recebíveis) pode levar segundos. Se rodar de forma síncrona no endpoint de webhook, o Asaas sofrerá timeout e reenviará — causando processamento duplicado.

**Regra:** o endpoint `POST /api/v1/webhooks/asaas` responde `202 Accepted` imediatamente e enfileira o processamento.

### 8.2 Filas definidas

| Fila | Disparada por | Processador |
|---|---|---|
| `pagamento-recebido` | Webhook PAYMENT_RECEIVED | Conciliação, baixa de fatura, cálculo de recebíveis |
| `pagamento-vencido` | Webhook PAYMENT_OVERDUE | Atualiza posição na régua, dispara D+1 |
| `fechar-fatura` | Job agendado (D-5) | Fecha fatura, gera cobrança no Asaas |
| `gerar-cobranca-asaas` | Fatura fechada | Cria cobrança avulsa no Asaas via API |
| `notificar-cliente` | Dia do vencimento | Envia WhatsApp via Z-API |
| `regua-step` | D+1, D+3, D+10, D+12 | Ações da régua conforme estágio |

### 8.3 Configuração do BullMQ

```typescript
// modules/queues/queues.module.ts
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'pagamento-recebido' },
      { name: 'pagamento-vencido' },
      { name: 'fechar-fatura' },
      { name: 'gerar-cobranca-asaas' },
      { name: 'notificar-cliente' },
      { name: 'regua-step' },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
```

---

## 9. Variáveis de ambiente

### 9.1 Backend (.env.example)

```bash
# Aplicação
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Banco de dados
DATABASE_URL="postgresql://azit_user:senha_local@localhost:5432/azit_v3"

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=troque-por-string-aleatoria-longa
JWT_EXPIRES_IN=7d

# Asaas
ASAAS_API_URL=https://api-sandbox.asaas.com/v3
ASAAS_API_KEY=
ASAAS_WEBHOOK_SECRET=

# PopHub
POPHUB_WEBHOOK_SECRET=

# Z-API (WhatsApp)
ZAPI_INSTANCE_ID=
ZAPI_TOKEN=
ZAPI_CLIENT_TOKEN=
```

### 9.2 Frontend (.env.example)

```bash
VITE_API_URL=http://localhost:3001
VITE_APP_ENV=development
```

### 9.3 Regra: nunca comitar .env

O arquivo `.env` é sempre ignorado pelo `.gitignore`. O `.env.example` é versionado e deve ser mantido atualizado a cada nova variável adicionada.

---

## 10. Scripts de desenvolvimento

### Setup inicial (uma vez)

```bash
# 1. Clonar e instalar dependências
git clone <repo>
cd azit-v3
pnpm install

# 2. Configurar variáveis de ambiente
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
# Editar os .env com os valores locais

# 3. Iniciar PostgreSQL e Redis (Docker recomendado)
docker run -d --name azit-postgres -e POSTGRES_USER=azit_user -e POSTGRES_PASSWORD=senha_local -e POSTGRES_DB=azit_v3 -p 5432:5432 postgres:16
docker run -d --name azit-redis -p 6379:6379 redis:7

# 4. Rodar migrations e seed
pnpm db:migrate:dev
pnpm db:seed

# 5. Iniciar tudo
pnpm dev
```

### Comandos do dia a dia

```bash
pnpm dev                 # inicia backend e frontend em paralelo
pnpm dev:backend         # só o backend
pnpm dev:frontend        # só o frontend
pnpm db:studio           # abre o Prisma Studio no browser
pnpm db:migrate:dev      # cria e aplica nova migration
pnpm test                # roda todos os testes
pnpm typecheck           # verifica tipos em todo o monorepo
pnpm lint                # linting em todo o monorepo
```

---

## 11. Convenções de código

### 11.1 Nomenclatura de arquivos

| Contexto | Convenção | Exemplo |
|---|---|---|
| Componentes React | PascalCase | `KanbanBoard.tsx` |
| Páginas | PascalCase + Page | `CarteiraPage.tsx` |
| Hooks | camelCase + prefixo `use` | `useContratos.ts` |
| Services (frontend) | camelCase + sufixo | `contratosService.ts` |
| Stores (Zustand) | camelCase + sufixo | `authStore.ts` |
| NestJS (todos) | kebab-case + sufixo | `contratos.service.ts` |
| Arquivos de tipo | camelCase | `status-parcela.ts` |

### 11.2 Nomenclatura de variáveis e tipos

| Item | Convenção | Exemplo |
|---|---|---|
| Interfaces TypeScript | PascalCase | `Contrato`, `FaturaResponse` |
| Enums | PascalCase (enum) + PascalCase (valores) | `StatusParcela.PAGA` |
| Constantes globais | SCREAMING_SNAKE_CASE | `ASAAS_WEBHOOK_SECRET` |
| Variáveis locais | camelCase | `saldoDevedor` |
| Propriedades de objeto | camelCase | `dataPrimeiroVencimento` |

### 11.3 Banco de dados (Prisma)

| Item | Convenção | Exemplo |
|---|---|---|
| Modelos Prisma | PascalCase singular | `Contrato`, `Fatura` |
| Campos Prisma | camelCase | `dataVencimento`, `valorTotal` |
| Tabelas geradas | snake_case plural | `contratos`, `faturas` |
| Índices | `idx_tabela_campo` | `idx_faturas_contrato_id` |

### 11.4 Regras gerais

- **Sem `any` em TypeScript** — usar tipos explícitos ou `unknown`
- **Sem lógica de negócio em controllers** — pertence ao service
- **Sem chamadas diretas ao Prisma fora de services** — o Prisma é injetado no service
- **Sem cores hardcoded em componentes** — usar `statusColors.ts` e tokens Tailwind
- **Sem status hardcoded como string literal** — usar os enums de `@azit/types`
- **Comentários em português** — o projeto é em português, comentários também

---

## 12. Ordem de inicialização do projeto

Para quem for configurar o ambiente pela primeira vez, seguir exatamente esta ordem:

1. Instalar Node.js 20.x e pnpm 9.x
2. Clonar o repositório
3. Rodar `pnpm install` na raiz
4. Subir PostgreSQL e Redis (Docker ou instalação local)
5. Copiar e preencher os `.env` de backend e frontend
6. Rodar `pnpm db:migrate:dev` para criar o schema no banco
7. Rodar `pnpm db:seed` para dados iniciais
8. Rodar `pnpm dev` para iniciar o ambiente completo
9. Acessar `http://localhost:3000` (frontend) e `http://localhost:3001/api/v1` (backend)

---

*Doc 4 — Setup e Estrutura do Projeto · Azit Move V3 · v1.0 · jun/2025*
*Documentos relacionados: Doc 1 — Design Thinking · Doc 2 — Spec de Domínio · Doc 3 — Guia Visual · Doc 5 — Prisma Schema*
