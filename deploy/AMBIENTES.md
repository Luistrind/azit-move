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

## 2. Dia a dia — do seu computador até a produção

A regra é uma só: **na produção só entra o que foi testado no homolog.** O
`deploy-prod.sh` confere isso sozinho (o homolog registra cada commit que
publica; a produção recusa uma versão que nunca passou por lá).

**1. Desenvolvimento local** — cada assunto na sua própria branch:

```bash
git switch -c feat/nome-do-assunto     # no seu computador
# ... desenvolve e testa local (pnpm dev) ...
git push -u origin feat/nome-do-assunto
```

O **CI** do GitHub roda a cada push (tipos, schema e testes do motor
financeiro). Se estiver vermelho, nem leve para o homolog.

**2. Testar no homolog** — publique a branch (não precisa passar pela `main`):

```bash
cd /opt/azit && git pull && bash deploy/deploy-hml.sh origin/feat/nome-do-assunto
```

Valide em https://hml.azitmove.com.br. Achou problema: corrige, faz push e
publica de novo. O homolog tem **uma versão por vez** — se estiver testando
duas coisas, publique por último a que vai promover.

**3. Aprovado vira candidato à produção** — junte na `main`:

```bash
git switch main && git merge --no-ff feat/nome-do-assunto && git push
```

A `main` guarda só o que já foi aprovado. Junto duas ou mais branches? Publique
a `main` no homolog e valide o conjunto, que é o que vai subir:

```bash
cd /opt/azit && git pull && bash deploy/deploy-hml.sh      # sem argumento = main
```

**4. Versionar** — a tag marca o que vai para a produção (o Claude cria, ou à mão):

```bash
git tag -a v1.1.0 -m "resumo do que entrou" && git push origin v1.1.0
```

Correção pequena aumenta o último número (v1.0.1); novidade aumenta o do meio
(v1.1.0).

**5. Publicar na produção:**

```bash
cd /opt/azit && git pull && bash deploy/deploy-prod.sh v1.1.0
```

O script mostra o que muda e quais migrações vão rodar, confirma que aquele
commit passou pelo homolog, pede a tag digitada, **faz backup**, publica,
migra e confere a saúde dos dois endereços.

### Onde está cada coisa

```bash
bash deploy/status.sh
```

Mostra o que está no homolog, qual release está na produção, **os commits que
já foram testados e ainda não subiram**, as últimas publicações, os backups
recentes e os serviços no ar.

### Se der errado

```bash
bash deploy/reverter-prod.sh            # volta para a release anterior
bash deploy/reverter-prod.sh v1.0.3     # ou para uma específica
```

Ele lista o que sai do ar, avisa quais migrações permanecem aplicadas, aponta o
backup feito antes da publicação problemática e reverte. O **código** volta em
segundos (as imagens de cada versão ficam guardadas). O **banco** não volta
sozinho — por isso migração é sempre aditiva: o código antigo continua rodando
sobre o banco novo. Se o problema tiver sido nos **dados**, aí sim:

```bash
bash deploy/restaurar-backup.sh azit /opt/azit-backups/azit/banco_XXXX_pre-v1.1.0.dump
```

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
- [ ] WhatsApp das notificações de cobrança (POP-COB-001, doc 02 §23 e §24 — opção C):
      0. **tirar o número do app WhatsApp Business** (faça backup das conversas antes e depois
         Configurações → Conta → Apagar conta). O número fica só na API; as respostas dos
         clientes passam a ser atendidas em **Conversas do WhatsApp**, no sistema;
      1. Meta for Developers: app Business + número dedicado na Cloud API + usuário do
         sistema com token permanente;
      2. **Configurações > Integrações > WhatsApp (Meta)**: id do número, token, chave
         secreta do app e token de verificação (botão Gerar) → Salvar → Testar conexão;
      3. no painel da Meta, webhook para `https://api.azitmove.com.br/api/v1/webhooks/whatsapp`
         com o mesmo token de verificação, assinando o campo **messages**;
      4. criar e aprovar o modelo (texto na tela *Notificações de cobrança*);
      5. só então **ligar o disparo automático** em Configurações > Notificações de cobrança.
      No homolog o disparo pode ficar ligado **sem** credencial: tudo sai SIMULADO.
      **Número único em todos os ambientes** (§23 item 10): no homolog/dev, só os números
      autorizados na tela recebem de verdade. O webhook aponta para o homolog durante os
      testes e passa para a produção no go-live.
- [ ] Monitoramento externo (UptimeRobot em `api.azitmove.com.br/api/v1/health`)

## 6-A. Reconstrução do banco (produção, 17/09) — resolve backup + limpeza

O banco de produção teve o schema `public` recriado em algum reset antigo: ele
ficou com OID 16392 e **244 registros de catálogo apontando para o schema
antigo (2200)**. O sistema funciona, mas o `pg_dump` falha inteiro
(`schema with OID 2200 does not exist`) — ou seja, **a produção não tinha como
ser copiada**. Em vez de cirurgia no catálogo, a correção é criar um banco novo
pelas migrações e copiar só o que fica:

```bash
bash deploy/reconstruir-banco.sh azit
```

Faz backup físico (`pg_basebackup`) e dos documentos, cria o banco novo, aplica
as migrações, copia as 20 tabelas de configuração na ordem das dependências,
confere contagem por tabela, testa o `pg_dump` no banco novo e só então troca
(backend para por segundos). O banco anterior vira `azit_antigo_<data>` — nada
é apagado, e o comando de volta aparece no fim. Ensaiado em cópia local em
17/09 antes de ir para produção.

Depois disso, o `limpar-dados.sh` abaixo só é necessário para limpezas futuras.

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
