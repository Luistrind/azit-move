# Fatura Azit — página pública da fatura (doc 02 §32). Build a partir da RAIZ do
# monorepo, igual ao frontend. VITE_API_URL é lido em BUILD TIME (Vite inlina).
FROM node:20-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm install --frozen-lockfile \
 && pnpm --filter @azit/types build \
 && pnpm --filter @azit/utils build \
 && pnpm --filter fatura build

# Servir o build estático com nginx (qualquer caminho = index.html: o token vem na URL).
FROM nginx:alpine
COPY apps/fatura/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/fatura/dist /usr/share/nginx/html
EXPOSE 80
