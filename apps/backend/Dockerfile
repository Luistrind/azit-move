# Backend (NestJS + Fastify) — build a partir da RAIZ do monorepo (pnpm workspaces).
# No EasyPanel: Source = repo GitHub; Build = Dockerfile;
#   Build context / raiz = "/"  (raiz do repositório)
#   Dockerfile path      = "apps/backend/Dockerfile"
FROM node:20-slim

# openssl/ca-certificates são exigidos pelos engines do Prisma no Debian slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .

# Instala o workspace inteiro (inclui devDeps: nest-cli, tsc, prisma) e compila
# os pacotes compartilhados → gera o client do Prisma → compila o backend.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @azit/types build \
 && pnpm --filter @azit/utils build \
 && pnpm --filter backend exec prisma generate \
 && pnpm --filter backend build

WORKDIR /app/apps/backend
ENV NODE_ENV=production
# A porta é lida de PORT (default 3001). Ajuste EXPOSE se mudar.
EXPOSE 3001

# Aplica as migrations pendentes e sobe. `prisma` está disponível (devDep não podado).
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
