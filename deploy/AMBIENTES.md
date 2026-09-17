# Ambientes do Azit — homologação e produção

Plano aprovado em 06/07 e liberado pelo Luís em 17/09. Todos os comandos abaixo
rodam **no servidor**, como root, dentro de `/opt/azit`.

| | Homologação | Produção |
|---|---|---|
| Endereço | https://hml.azitmove.com.br | https://app.azitmove.com.br |
| API | https://api-hml.azitmove.com.br | https://api.azitmove.com.br |
| Stack no Swarm | `azit-hml` | `azit` |
| Segredos | `deploy/stack-hml.env` | `deploy/stack.env` |
| Publica a partir de | branch `main` | **tag de release** (`vX.Y.Z`) |
| Banco, Redis, documentos | próprios | próprios |
| Asaas | sempre sandbox | sandbox → chave real no go-live |
| Ferramentas de teste (simular pagamento/assinatura) | **ligadas** | desligadas |
| Identificação visual | faixa vermelha "HOMOLOGAÇÃO" + `[HOMOLOG]` na aba | nenhuma |
| Backup | manual | diário 02:30 + antes de cada publicação |

O checkout `/opt/azit` só guarda os scripts: as imagens são sempre construídas
em uma cópia separada do código (`/opt/azit-build`), a partir da `main` (homolog)
ou da tag (produção).

---

## 1. Primeira vez (uma única vez)

**1.1 DNS** — no registro.br, crie dois registros **A** para o IP do VPS
`147.79.81.186` (iguais aos de `app` e `api`):

- `hml` → 147.79.81.186
- `api-hml` → 147.79.81.186

**1.2 Homologação**

```bash
cd /opt/azit && git pull
bash deploy/init-env-hml.sh       # gera deploy/stack-hml.env e mostra o token do webhook
bash deploy/deploy-hml.sh         # build + stack + migrações + dados de teste
```

No painel **sandbox** do Asaas, adicione o **segundo** webhook que o
`init-env-hml.sh` mostrou (URL `api-hml` + token próprio). Os dois ambientes
compartilham a conta sandbox até a produção virar a chave real — cada um ignora
as cobranças que não são suas.

Logins do homolog (dados de teste): `admin@`, `diretor@`, `aprovador@`,
`operador@`, `financeiro@azit.com.br` — senha `azit123`.

**Depois de um seed novo, ative o catálogo** (Configurações não: tela *Catálogo de
produtos*): o seed cria os produtos em **Rascunho** e, assim, os motores rodam no
modo placeholder — o homolog não reproduziria a produção. Deixe igual à produção:
`compra_parcelada` (e as variantes carro/moto/outro), `protecao_veicular`,
`reembolso_parcelado` e `acordo_pagamento` **ATIVOS**; `novacao` em Rascunho
até o jurídico liberar. Feito em 17/09 na primeira subida.

**1.3 Backup diário da produção**

```bash
bash deploy/instalar-backup-diario.sh
bash deploy/backup.sh azit teste     # confere que funciona
```

**1.4 Primeira release da produção** (a tag `v1.0.0` já existe no repositório)

```bash
bash deploy/deploy-prod.sh v1.0.0
```

---

## 2. Dia a dia

1. Mudança feita e enviada para a `main` → o **CI** do GitHub verifica tipos,
   schema e os testes do motor financeiro (aba *Actions*).
2. Publicar no homolog: `cd /opt/azit && git pull && bash deploy/deploy-hml.sh`
3. Validar em https://hml.azitmove.com.br.
4. Criar a release (Claude faz, ou à mão):
   `git tag -a v1.0.1 -m "resumo das mudanças" && git push origin v1.0.1`
5. Publicar na produção: `cd /opt/azit && git pull && bash deploy/deploy-prod.sh v1.0.1`
   — o script mostra as mudanças e as migrações, pede a tag digitada, faz backup,
   publica, migra e confere a saúde.

**Rollback:** `bash deploy/deploy-prod.sh <tag anterior>` (a última linha do
publicação mostra o comando exato). O código volta; migrações não voltam — por
isso a regra de migração só aditiva.

Histórico de releases publicadas: `cat /opt/azit-backups/releases.log`

---

## 3. Checklist antes de cada publicação em produção

- [ ] CI verde na tag
- [ ] Validado no homolog
- [ ] Migrações apenas **aditivas** (nada de apagar/renomear coluna com dado)
- [ ] Nada de dado de produção levado para o homolog (LGPD)
- [ ] Horário tranquilo (sem cobrança/entrada sendo paga no momento)

---

## 4. Backups

- Local: `/opt/azit-backups/<stack>/` — `banco_*.dump` (pg_dump) e
  `documentos_*.tar.gz` (CNH, extratos, contratos assinados).
- Retenção: diários 7 dias; pré-publicação 30 dias.
- Manual: `bash deploy/backup.sh azit meu-motivo`
- Restaurar (destrutivo, pede confirmação e faz backup antes):
  `bash deploy/restaurar-backup.sh azit /opt/azit-backups/azit/banco_XXXX.dump`
- **Pendente (Fase 2):** cópia fora do servidor (se o VPS morrer, os backups
  locais morrem junto).

---

## 5. Go-live — transformar o ambiente atual em produção de verdade

- [ ] Homolog no ar e validado
- [ ] Backup diário instalado
- [ ] Produção publicada por release (`deploy-prod.sh v1.0.0`)
- [ ] **Dados de teste da produção** — decidir o que fica (ver seção 6)
- [ ] Trocar as senhas de todos os usuários de produção (`senha123`/`azit123`
      já circularam em conversa)
- [ ] Rotacionar o `MCP_SECRET` (apareceu em prints) e atualizar a URL do
      connector no claude.ai
- [ ] Asaas real: **Configurações > Integrações** → Produção → API key da conta
      real → Salvar → Testar conexão; webhook no painel real apontando para
      `api.azitmove.com.br` com o segredo; mover o webhook do sandbox para
      ficar só com o `api-hml`
- [ ] ZapSign: token de produção (Integrações) + webhook no painel
- [ ] BigDataCorp: credenciais reais conferidas (a produção cobra por consulta)
- [ ] Monitoramento externo (UptimeRobot em `api.azitmove.com.br/api/v1/health`)

## 6. Limpeza da produção (decisão do Luís antes de rodar)

`bash deploy/limpar-dados.sh azit` apaga todo o movimento (titulares, contratos,
faturas, análises, contas a pagar) e **mantém** usuários, alçadas, catálogo,
parâmetros e a fundação do financeiro. Faz backup antes e pede confirmação
digitada. Atenção: análises com pessoas reais (ex.: prospects já avaliados)
também seriam apagadas — decida antes o que precisa ser preservado.

## 7. Scripts aposentados

`update-backend.sh` e `update-frontend.sh` agora só mostram o fluxo novo (a
produção não é mais publicada da `main`). `reset-db.sh` e `db-clean.sh` pedem
confirmação `APAGAR-PRODUCAO`.
