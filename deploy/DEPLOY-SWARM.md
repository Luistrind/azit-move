# Deploy no servidor PopCarros (Docker Swarm + Traefik existente)

O Azit sobe como um **stack novo** atrás do **Traefik** que já roda no servidor
(rede `PopCarrosNet`, cert resolver `letsencryptresolver`). Postgres e Redis são
**próprios do Azit** e ficam numa rede interna (sem exposição). Nada do que já roda
é tocado.

## 0. Pré-requisito: DNS
No provedor de DNS do `popcarros.com.br`, crie 2 registros **A** apontando para o IP do VPS `147.79.81.186`:
- `azit`      → 147.79.81.186   (frontend → `azit.popcarros.com.br`)
- `api-azit`  → 147.79.81.186   (backend  → `api-azit.popcarros.com.br`)

Espere propagar (alguns minutos). O Let's Encrypt só emite o certificado depois que o domínio resolve para o servidor.

## 1. Clonar o repositório no servidor
```
mkdir -p /opt && cd /opt
git clone https://github.com/Luistrind/azit-move.git azit
cd azit
```
> Se o repo for **privado**, use um token: `git clone https://TOKEN@github.com/Luistrind/azit-move.git azit`
> (ou deixe o repo público temporariamente — ele não tem segredos).

## 2. Buildar as imagens (single-node Swarm → build local)
```
docker build -t azit-backend:latest -f apps/backend/Dockerfile .
docker build -t azit-frontend:latest --build-arg VITE_API_URL=https://api-azit.popcarros.com.br -f apps/frontend/Dockerfile .
```
> O `VITE_API_URL` é fixado no build do frontend. Se mudar o domínio da API, rebuild o frontend.

## 3. Preencher os segredos
```
cp deploy/stack.env.example deploy/stack.env
nano deploy/stack.env          # preencha POSTGRES_PASSWORD, JWT_SECRET, ASAAS_API_KEY, ASAAS_WEBHOOK_SECRET
```

## 4. Subir o stack
```
set -a; . deploy/stack.env; set +a
docker stack deploy -c deploy/azit-stack.swarm.yml azit
```
Acompanhe:
```
docker stack services azit
docker service logs -f azit_backend
```
No log do backend você deve ver as migrations aplicadas e `Nest application successfully started`.

## 5. Seed inicial (opcional — cria admin + catálogos)
```
docker exec -it $(docker ps -qf name=azit_backend) sh -lc "pnpm exec ts-node prisma/seed.ts"
```

## 6. Ligar o Asaas (uma vez só, URL fixa)
No painel do Asaas → Webhooks:
- URL: `https://api-azit.popcarros.com.br/api/v1/webhooks/asaas`
- Token: o MESMO valor de `ASAAS_WEBHOOK_SECRET`.
- v3, envio Sequencial, eventos de Cobranças: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE.

## 7. Testar
- Abra `https://azit.popcarros.com.br`, faça login e rode o fluxo.
- Um pagamento no sandbox → webhook chega → contrato ativa.

---

## Atualizar depois (novo deploy)
```
cd /opt/azit && git pull
docker build -t azit-backend:latest -f apps/backend/Dockerfile .
docker build -t azit-frontend:latest --build-arg VITE_API_URL=https://api-azit.popcarros.com.br -f apps/frontend/Dockerfile .
set -a; . deploy/stack.env; set +a
docker stack deploy -c deploy/azit-stack.swarm.yml azit   # atualiza os serviços
```

## Remover (se precisar) — reversível
```
docker stack rm azit          # remove os serviços (o volume azit_pgdata com os dados PERSISTE)
# para apagar os dados também: docker volume rm azit_azit_pgdata
```

## Notas
- **Não** remover o serviço `traefik` nem a rede `PopCarrosNet` — o Azit (e seus outros apps) dependem deles.
- As labels do Traefik ficam em `deploy.labels` (padrão Swarm) — mesmo esquema do n8n/portainer/qdrant.
- Postgres/Redis do Azit não têm porta publicada: só o backend do stack os enxerga.
