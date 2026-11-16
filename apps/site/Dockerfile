# Site institucional da Azit Move (azitmove.com.br). Só arquivos estáticos: não
# depende do build do monorepo. Build a partir da RAIZ do repositório.
FROM nginx:alpine
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/site/public /usr/share/nginx/html
EXPOSE 80
