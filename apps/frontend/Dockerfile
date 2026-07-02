# Frontend (React + Vite, SPA) — build a partir da RAIZ do monorepo.
# No EasyPanel: Build context / raiz = "/"; Dockerfile path = "apps/frontend/Dockerfile".
# IMPORTANTE: VITE_API_URL é lido em BUILD TIME (Vite inlina no bundle). Passe como
#   Build Arg apontando para a URL pública do backend, ex: https://api.seu-dominio.com
FROM node:20-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm install --frozen-lockfile \
 && pnpm --filter @azit/types build \
 && pnpm --filter @azit/utils build \
 && pnpm --filter frontend build

# Servir o build estático com nginx (fallback SPA).
FROM nginx:alpine
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
