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

**1.5 Google Cloud — entrar com Google (doc 06 v1.1 §2.2)** — feito em 12/11/2026 pelo Luís com o Claude, conta `luis@azit.com.br`:

- Projeto `azit-hub` (nome "Azit Hub"), dentro da organização do Workspace; tela de permissão OAuth com público **Interno** (só contas `azit.com.br` / `azitmove.com.br` conseguem entrar, já do lado do Google).
- Cliente OAuth **Azit Hub Web** (tipo aplicativo da Web). O fluxo é de ID token (botão do Google no navegador), então só o **client id** é usado; a chave secreta do cliente não é usada e não deve ser copiada para lugar nenhum.
- `GOOGLE_CLIENT_ID=43681993535-8orbgnirmtc7p3lbu5ov0f2hvfp46g58.apps.googleusercontent.com` (é público por natureza; vai no backend como variável e no frontend como `VITE_GOOGLE_CLIENT_ID`, em build time como o `VITE_API_URL`). O mesmo cliente serve homolog e produção.
- Origens JavaScript autorizadas: `https://app.azitmove.com.br`, `https://hml.azitmove.com.br`, `http://localhost:3000`. Sem URIs de redirecionamento (não há fluxo de servidor).
- Onde mexer: https://console.cloud.google.com/auth/clients?project=azit-hub (mudança de domínio ou porta local exige acrescentar a origem lá; pode levar alguns minutos para valer).
- O bloco 3 (alertas por e-mail, doc 06 §12) usa este MESMO projeto para a conta de serviço do Gmail; a chave dela é segredo e entra só no `stack.env` do servidor.

**1.6 Bloco 2 do doc 06 v1.1 — entrar com Google (13/11/2026): o que muda no servidor e a ordem de migração**

Variáveis (o id é público; o valor está em 1.5):

```bash
# uma vez, no servidor — os init-env*.sh já escrevem isso em arquivo NOVO; em arquivo existente, acrescente:
echo 'GOOGLE_CLIENT_ID=43681993535-8orbgnirmtc7p3lbu5ov0f2hvfp46g58.apps.googleusercontent.com' >> /opt/azit/deploy/stack-hml.env
echo 'GOOGLE_CLIENT_ID=43681993535-8orbgnirmtc7p3lbu5ov0f2hvfp46g58.apps.googleusercontent.com' >> /opt/azit/deploy/stack.env
```

- Backend lê `GOOGLE_CLIENT_ID` (stacks swarm já passam `${GOOGLE_CLIENT_ID:-}`); sem ela `POST /auth/google` responde 503 e o botão não aparece (a tela consulta `GET /auth/config`). Confira em Configurações › Integrações › "Google — entrada no sistema".
- Frontend recebe `VITE_GOOGLE_CLIENT_ID` como build-arg (build.sh, deploy-hml.sh, deploy-prod.sh) — é só reserva; a fonte preferida é o backend, então o mesmo build serve hml e prod.
- O backend sobe com `trustProxy: true` (IP real atrás do Traefik, para o limite de 10 tentativas/min por IP e o registro de acessos).

Migração do banco (roda no deploy, aditiva): `senhaHash` vira opcional, `permiteSenha` nasce `false` para TODOS os usuários existentes, `googleSub` nulo, tabela `acessos_usuario`.

**Homolog** — `bash deploy/deploy-hml.sh origin/feat/acesso-areas-google-email`. O seed (só banco vazio) liga `permiteSenha` nos cinco usuários de teste (`azit123` continua valendo) e cria `luis@azit.com.br` como ADMIN sem senha. Em banco de homolog JÁ EXISTENTE o seed não roda: entre com `admin@azit.com.br`… — **atenção:** após a migração o `admin@` também fica com `permiteSenha=false`. Antes do deploy-hml, ligue no banco de homolog para os usuários de teste:

```bash
docker exec $(docker ps -qf name=azit-hml_azit-db) psql -U azit -d azit -c "update usuarios set \"permiteSenha\"=true where email in ('admin@azit.com.br','diretor@azit.com.br','aprovador@azit.com.br','operador@azit.com.br','financeiro@azit.com.br');"
```

(se a coluna ainda não existir, rode DEPOIS do deploy — o comando é idempotente). E cadastre o Luís como usuário do homolog (Usuários e permissões › Novo usuário, e-mail `luis@azit.com.br`, papel Administrador, sem senha) se ele não existir — o roteiro de teste do Google precisa disso.

**Produção** — ordem obrigatória (doc 06 §11.6, bloco 2):
1. ANTES do deploy, com a versão atual no ar, nada muda: todos entram por senha.
2. Logo após o deploy, todo mundo fica com `permiteSenha=false` — ninguém entra por senha, só pelo Google. **Rede de segurança:** antes de publicar, garanta que o Luís existe como usuário com e-mail do Workspace (`luis@azit.com.br` ou `luis@azitmove.com.br`) e papel Administrador. Se quiser a senha como reserva durante a virada, ligue-a para o próprio usuário pelo banco logo após a migração (`update usuarios set "permiteSenha"=true where email='luis@azit.com.br';`) e desligue pela tela depois de entrar pelo Google.
3. Para cada colaborador: confira em Usuários e permissões que o e-mail cadastrado é o do Workspace (a parte local é o que vale; `@azit.com.br` e `@azitmove.com.br` são a mesma caixa). Quem tiver e-mail de fora do domínio não entra pelo Google — corrija o e-mail ou ligue a senha com motivo.
4. Senha de reserva só por exceção, ligada por usuário em Usuários e permissões (auditada com motivo).

**1.7 WhatsApp — Cloud API da Meta (doc 02 §23, §24 e §28; 15/11/2026)**

O que entra: o canal (credenciais, regra de envio, webhook), os lembretes de pagamento D-2 e D0 com o link da Fatura Azit e a tela Conversas. A notificação formal da POP fica para depois.

Variáveis do backend — **todas opcionais**; o caminho normal é a tela **Configuração › Integrações › WhatsApp (Meta)** (banco tem precedência; o que estiver no `stack.env` é adotado no boot quando o campo está vazio):

| Variável | O que é | Segredo? |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | id do número na Cloud API | não |
| `WHATSAPP_WABA_ID` | id da conta do WhatsApp Business | não |
| `WHATSAPP_ACCESS_TOKEN` | token permanente do usuário do sistema | **sim** |
| `WHATSAPP_APP_SECRET` | chave secreta do aplicativo (assina o webhook) | **sim** |
| `WHATSAPP_VERIFY_TOKEN` | token inventado por você, repetido no painel da Meta ao cadastrar o webhook | **sim** |
| `WHATSAPP_GRAPH_VERSION` | versão da Graph API (padrão `v23.0`) | não |

Os stacks já passam as seis (`${VAR:-}`); os `init-env*.sh` escrevem as cinco primeiras vazias em arquivo NOVO. Em `stack.env` existente não é preciso acrescentar nada: cadastre pela tela. Token e chave secreta nunca vão para log, repositório ou conversa.

Regra de envio (doc 02 §23.1 e §23.2), igual em todo lugar:

- **Produção nunca simula.** Sem id do número + token, o lembrete fica RETIDO; a chave geral nem liga.
- **Homologação e desenvolvimento usam o MESMO número real.** Só recebem de verdade os **números autorizados** em Configuração › WhatsApp (lista do banco de cada ambiente). Qualquer outro destino vira SIMULADO. Lista vazia = nada real sai.
- Chave geral dos envios automáticos **desligada por padrão**; o lembrete também nasce desligado por titular (liga-se na ficha).

Modelos de mensagem (WhatsApp Manager › Modelos de mensagem) — categoria **Utilidade**, idioma **Português (BR)** (`pt_BR`), botão "Acessar o site" com URL **dinâmica**. O botão tem domínio fixo, então homolog e produção usam modelos diferentes; o nome de cada um é parâmetro de Configuração › WhatsApp de cada ambiente (a tela mostra o texto e o endereço a cadastrar). O padrão já vem certo — produção sem sufixo, homologação com `_hml` — e só precisa ser trocado se o modelo for criado com outro nome:

| Ambiente | Momento | Nome do modelo | URL do botão |
|---|---|---|---|
| produção | 2 dias antes | `azit_fatura_disponivel` | `https://fatura.azitmove.com.br/{{1}}` |
| produção | dia do vencimento | `azit_fatura_vence_hoje` | `https://fatura.azitmove.com.br/{{1}}` |
| homologação | 2 dias antes | `azit_fatura_disponivel_hml` | `https://fatura-hml.azitmove.com.br/{{1}}` |
| homologação | dia do vencimento | `azit_fatura_vence_hoje_hml` | `https://fatura-hml.azitmove.com.br/{{1}}` |
| produção | 2 dias de atraso | `azit_fatura_atraso` | `https://fatura.azitmove.com.br/{{1}}` |
| homologação | 2 dias de atraso | `azit_fatura_atraso_hml` | `https://fatura-hml.azitmove.com.br/{{1}}` |

Pix copia e cola na mensagem (doc 02 §28.6, 22/11) — tipo **Detalhes do pedido** (Utilidade), botão fixo da Meta "Copiar código Pix", **sem botão de link** (a Meta não aceita junto): o link da fatura vai inteiro no texto como `{{5}}`, então os MESMOS modelos servem aos dois ambientes — `azit_fatura_pix_disponivel` (2 dias antes) e `azit_fatura_pix_vence_hoje` (dia do vencimento). Só quem tem uma fatura em aberto recebe; os outros recebem o modelo de link. Se o modelo de Pix for recusado no envio, o lembrete sai pelo de link. O cartão mostra o recebedor de Configuração › WhatsApp (padrão: razão social).

Corpo (variáveis: `{{1}}` primeiro nome, `{{2}}` número da fatura, `{{3}}` valor, `{{4}}` vencimento) — texto provisório, fonte única em `packages/utils/src/whatsapp.ts`:

- 2 dias antes: `Olá, {{1}}! Aqui é da Azit Move. Sua fatura nº {{2}}, de {{3}}, vence em {{4}}. Toque no botão abaixo para ver os itens e pagar com Pix. O valor da página é atualizado em tempo real.`
- dia do vencimento: `Olá, {{1}}! Aqui é da Azit Move. Sua fatura nº {{2}}, de {{3}}, vence hoje ({{4}}). Toque no botão abaixo para pagar com Pix. Se já pagou, desconsidere esta mensagem.`
- Texto do botão: `Ver fatura`. Exemplos para a aprovação: `João`, `12`, `R$ 699,00`, `16/11/2026` e, no botão, um código de 64 caracteres.

Webhook — o aplicativo da Meta aponta para **uma** URL, assinando o campo **messages**:

- durante a homologação: `https://api-hml.azitmove.com.br/api/v1/webhooks/whatsapp`
- na entrada em produção: `https://api.azitmove.com.br/api/v1/webhooks/whatsapp` (o homolog deixa de receber entrega e leitura; as ferramentas de teste simulam esses carimbos)

Ordem no painel: (1) salve o token de verificação e a chave secreta em Configuração › Integrações; (2) na Meta, Webhooks › WhatsApp Business Account › informe a URL e o mesmo token de verificação; (3) assine **messages**. Produção recusa webhook sem a chave secreta cadastrada.

Migrações (aditivas, rodam no deploy): `20261115120000_whatsapp_canal` e `20261115130000_lembretes_pagamento`.

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
- [ ] WhatsApp dos lembretes de pagamento (doc 02 §23, §24 e §28 — detalhes em 1.7):
      0. o número dedicado fica **só na API** (se estiver no aplicativo WhatsApp Business, faça
         backup das conversas e apague a conta do aplicativo antes de registrá-lo na Cloud API);
         as respostas dos clientes passam a ser atendidas em **Carteira › Conversas do WhatsApp**;
      1. Meta for Developers: aplicativo de negócios + número na Cloud API + usuário do sistema
         com token permanente;
      2. **Configuração › Integrações › WhatsApp (Meta)**: id do número, id da conta, token,
         chave secreta do aplicativo e token de verificação → Salvar → Testar conexão;
      3. no painel da Meta, webhook para `https://api.azitmove.com.br/api/v1/webhooks/whatsapp`
         com o mesmo token de verificação, assinando o campo **messages**;
      4. criar e aprovar os dois modelos de produção (texto em Configuração › WhatsApp);
      5. jurídico confirma o consentimento → ligar o lembrete por titular, na ficha;
      6. só então **ligar a chave geral** em Configuração › WhatsApp.
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

---
**1.8 Site institucional — azitmove.com.br (15/11/2026)**

Página estática em `apps/site/public` (protótipo aprovado pelo Luís a partir da landing da V4), servida por nginx num serviço próprio do Swarm, **fora dos stacks** `azit` e `azit-hml`: publicar o site não mexe no Hub, na API nem na fatura.

1. **DNS (uma vez, pelo Luís):** registros `A` de `azitmove.com.br` e `www.azitmove.com.br` apontando para `147.79.81.186`. Não mexer nos registros `MX`/`TXT` do e-mail do Workspace.
2. **Publicar:** `cd /opt/azit && git fetch -q origin && bash deploy/deploy-site.sh origin/feat/site-institucional` (depois do merge, `origin/main`). O certificado sai sozinho pelo Traefik na primeira requisição, depois que o DNS propagar. `www` redireciona para o endereço sem `www`.
3. **Reverter:** o mesmo comando com o ref anterior.

O botão de WhatsApp do site leva, provisoriamente, ao número da API (27) 99833-7097, até o Luís definir o comercial (constante `WHATS` no fim do `index.html`). A campanha (Black Friday) some sozinha depois da data em `CAMPANHA.fim`. Política de privacidade e termos entram no rodapé só depois da validação do jurídico.
