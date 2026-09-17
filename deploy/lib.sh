#!/usr/bin/env bash
# Funções comuns dos scripts de ambiente (17/09). Uso: source deploy/lib.sh
# Convenção de stacks no Swarm:  azit = PRODUÇÃO   ·   azit-hml = HOMOLOGAÇÃO

REPO_DIR="/opt/azit"
BUILD_ROOT="/opt/azit-build"
BACKUP_ROOT="/opt/azit-backups"

ok()    { printf '\033[32m✔ %s\033[0m\n' "$*"; }
aviso() { printf '\033[33m! %s\033[0m\n' "$*"; }
erro()  { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; }
etapa() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

# Carrega um .env SEM expandir '$' nos valores (a chave do Asaas começa com '$').
carregar_env() {
  local arquivo="$1"
  [ -f "$arquivo" ] || { erro "Arquivo de segredos não encontrado: $arquivo"; return 1; }
  while IFS='=' read -r k v || [ -n "$k" ]; do
    case "$k" in ''|'#'*) continue ;; esac
    export "$k=$v"
  done < "$arquivo"
}

# ID do container de um serviço do Swarm (filtro EXATO pelo nome do serviço —
# 'azit_backend' nunca casa com 'azit-hml_backend').
container_do_servico() {
  docker ps -q --filter "label=com.docker.swarm.service.name=$1" | head -1
}

# Espera o container do serviço existir e responder (até ~2 min).
aguardar_servico() {
  local servico="$1" cid=""
  for _ in $(seq 1 40); do
    cid=$(container_do_servico "$servico")
    if [ -n "$cid" ] && docker exec "$cid" true 2>/dev/null; then
      echo "$cid"
      return 0
    fi
    sleep 3
  done
  erro "Serviço $servico não ficou pronto a tempo — veja: docker service ps $servico --no-trunc"
  return 1
}

# Cria um worktree limpo do repositório em um ref (branch/tag) para buildar
# sem tocar no checkout /opt/azit (que só guarda os scripts).
preparar_worktree() {
  local destino="$1" ref="$2"
  git -C "$REPO_DIR" fetch --tags --prune origin >/dev/null
  git -C "$REPO_DIR" worktree remove --force "$destino" 2>/dev/null || true
  rm -rf "$destino"
  git -C "$REPO_DIR" worktree prune
  mkdir -p "$(dirname "$destino")"
  git -C "$REPO_DIR" worktree add --detach "$destino" "$ref" >/dev/null
  ok "Código em $ref ($(git -C "$destino" rev-parse --short HEAD)) preparado em $destino"
}

remover_worktree() {
  git -C "$REPO_DIR" worktree remove --force "$1" 2>/dev/null || rm -rf "$1"
  git -C "$REPO_DIR" worktree prune
}

# Aplica as migrações DENTRO do container do backend (a imagem nova as contém).
migrar() {
  local cid="$1" saida
  if ! saida=$(docker exec "$cid" sh -lc "cd /app/apps/backend && pnpm exec prisma migrate deploy" 2>&1); then
    echo "$saida" | tail -25
    erro "Migração falhou — o backend novo está no ar sem as migrações; corrija e rode de novo"
    return 1
  fi
  echo "$saida" | tail -25
  ok "Migrações aplicadas"
}

# Confirmação digitada de ação destrutiva. DESCARTA o que já estiver no buffer
# do terminal antes de perguntar: colar dois comandos de uma vez fazia o
# segundo virar "resposta" (e o primeiro abortar) — caso real 17/09.
confirmar() {
  local esperado="$1" pergunta="$2" resposta=""
  while read -r -t 0.05 -n 4096 _descartado < /dev/tty; do :; done 2>/dev/null
  if ! read -r -p "$pergunta" resposta < /dev/tty 2>/dev/null; then
    erro "Sem terminal interativo — esta ação exige confirmação digitada."
    return 1
  fi
  if [ "$resposta" != "$esperado" ]; then
    erro "Confirmação não confere (esperado: $esperado) — nada foi feito."
    return 1
  fi
  return 0
}

# Checagem de saúde pela URL pública (passa pelo Traefik + TLS).
checar_saude() {
  local url="$1"
  for _ in $(seq 1 20); do
    if curl -fsS -o /dev/null --max-time 5 "$url"; then ok "Saúde OK: $url"; return 0; fi
    sleep 3
  done
  erro "Sem resposta saudável em $url"
  return 1
}
