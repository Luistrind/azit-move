# Desenho — Fluxo de Assinatura Digital com ZapSign

**Azit Hub — documento de alinhamento — agosto/2026**
Status: **DESENHO** (nada foi desenvolvido). Baseado na documentação oficial consolidada da API ZapSign (docs.zapsign.com.br) e no estado atual do sistema (assinatura mock na formalização).

---

## 1. Onde o sistema precisa de assinatura hoje

| # | Instrumento | Situação atual | Signatários |
|---|-------------|----------------|-------------|
| 1 | **Contrato de venda com reserva de domínio** (+ contratos apartados do pacote, ex.: proteção) | Documento gerado pelo motor de templates e congelado no snapshot; assinatura é **mock** (botão "assinar" marca titular/Azit) | Titular (+ comprador solidário, + garantidor) e Azit |
| 2 | **Termo do Reembolso Parcelado** (vinculado à CONTA — decisão 03/08) | Contrato criado via motor de aprovação; sem instrumento assinável ainda | Titular e Azit |
| 3 | **Acordo (renegociação) e Novação** | Efetivados pelo motor de aprovação; sem instrumento assinável | Titular e Azit |
| 4 | **Autorização de consulta de cadastro** (doc novo da Política de Análise — D1) | Documento obrigatório da análise; hoje é checagem manual | Só o titular (aceite) |
| 5 | (futuro) Contratos de investidor / captação | Fora do V1 | Investidor e Azit |

A regra do domínio permanece intocada: **assinatura (titular + Azit) → cobrança da entrada → pagamento → dia zero → cronograma**. A ZapSign só substitui o "como se assina"; o gate da ativação continua o mesmo.

---

## 2. O que aproveitar da API (e o que não)

### Aproveitar

- **Criar documento por `markdown_text`** — encaixe direto: nosso motor de templates gera texto; a ZapSign monta o PDF. Elimina a necessidade de gerador de PDF no backend na V1. (Alternativa `base64_pdf` fica de reserva se o layout não agradar.)
- **Envelope (documento + anexos extras)** — o pacote da formalização (contrato do veículo + apartados) vira **uma única sessão de assinatura**: o cliente assina tudo de uma vez. Ganho grande de UX.
- **Configuração por signatário** — `qualification` (comprador, comprador solidário, garantidor), `require_cpf`/`validate_cpf` (valida CPF + nome + nascimento na Receita), `lock_name/lock_email/lock_phone`, `external_id` (nosso id de vínculo).
- **Ordem de assinatura** (`signature_order_active` + `order_group`) — cliente(s) assinam primeiro; Azit por último.
- **`sign_url` por signatário** — o operador compartilha o link por WhatsApp direto da tela (grátis) ou a ZapSign envia automaticamente (R$ 0,50/envio, decisão de custo).
- **Assinar em lote via API (`user_token`)** — automatiza a assinatura da Azit: quando todos os clientes assinaram, o sistema assina pela Azit sem ninguém abrir a ZapSign. **Requer add-on de assinatura em lote no plano** (ver gargalo G3).
- **Webhooks** (`doc_signed`, `doc_refused`, `doc_viewed`, `doc_expired`, `email_bounce`) — substituem o mock. Entram no nosso padrão: responder 202 e processar via fila BullMQ, idempotente (a ZapSign reenvia quando não recebe 200).
- **`external_id` + `metadata`** — correlação com o contrato/termo nosso; volta em todos os webhooks.
- **`date_limit_to_sign` + `reminder_every_n_days` + alerta de expiração** — validade e lembretes automáticos sem cron nosso.
- **`folder_path`** — organização na ZapSign espelhando os tipos: `/contratos/`, `/termos-rp/`, `/acordos/`, `/autorizacoes/`.
- **Marca** (`brand_name`, `brand_logo`, `brand_primary_color`) — experiência "Azitmove via ZapSign".
- **OneClick (clickwrap)** — perfeito para a **autorização de consulta de cadastro** e aceites LGPD: um clique, com relatório de assinatura (IP, dispositivo). Não usar para contratos.
- **Widget (iframe)** — assinatura embutida no **modo balcão**: o cliente assina na tela/tablet do operador sem sair do sistema; eventos `zs-doc-signed` via postMessage.
- **Sandbox** — homologação completa sem validade jurídica e sem consumir plano.

### Não aproveitar (por decisão de arquitetura)

- **Modelos DOCX da ZapSign** — nosso motor de templates é a fonte da verdade e o documento é congelado no snapshot do contrato (auditoria). Templates continuam internos.
- **Background checks** — os birôs da análise já estão decididos (BigDataCorp/Quod/BoaVista); manter fora.
- **Criação de usuários da conta via API** — gestão manual na plataforma (poucos usuários).
- **Carimbo de tempo** — avaliar depois; não é requisito atual.

---

## 3. O fluxo desenhado (formalização — principal)

```
Formalização concluída (como hoje: snapshot + documento gerados)
        │
        ▼
[NOVO] Botão "Enviar para assinatura" na conclusão da proposta
        │  cria o documento na ZapSign (markdown_text do snapshot)
        │  + anexos (contratos apartados) → envelope único
        │  signers: titular (+solidários +garantidores) e Azit, em ordem
        │  external_id = contratoId · pasta /contratos/ · validade alinhada
        ▼
Cliente recebe o link (WhatsApp pelo operador, ou widget no balcão)
        │  visualiza → webhook doc_viewed → tela mostra "visualizou"
        │  assina  → webhook doc_signed  → marca assinaturaTitularEm
        ▼
Azit assina (automático via assinatura em lote quando todos os
clientes assinaram — ou manual, decisão pendente)
        │  webhook doc_signed final → baixa o PDF assinado (link expira
        │  em 60 min!) → armazena no nosso lado → assinaturaAzitEm
        ▼
Ativação habilitada (gate atual intacto): cobrança da entrada no Asaas
→ pagamento → dia zero → cronograma
        
Recusa (doc_refused) ou expiração → contrato volta para a etapa de
formalização com o motivo visível em tela; reenvio cria documento NOVO
na ZapSign (consome crédito do plano — ver G2).
```

Os fluxos do **termo do RP**, **acordo** e **novação** seguem o mesmo esqueleto (criar doc → links → webhooks → PDF armazenado), disparados na efetivação da aprovação. A **autorização de consulta** usa OneClick dentro da análise.

### Objetos novos no sistema (quando for construído)

- **`DocumentoAssinatura`** — espelho do documento na ZapSign: tipo (contrato/termo RP/acordo/autorização), vínculo (contrato ou conta), `docToken`, status (Rascunho → Enviado → Visualizado → Parcialmente assinado → **Assinado** | Recusado | Expirado | Cancelado), lista de signatários espelhada (signerToken, papel, visualizou em, assinou em), caminho do PDF assinado armazenado.
- **Módulo `assinatura`** com o provider ZapSign **isolado atrás de interface** (mesmo padrão do Asaas: "ZapSign executa, Azit controla") + rota de webhook `202 + fila`.
- **Parâmetros na central**: token/ambiente, assinatura automática da Azit (on/off), método de autenticação por produto, envio automático WhatsApp (on/off), chave de virada geral **assinatura digital ligada/desligada** (padrão: desligada; mock continua até homologar — placeholder Regra 12).

### Em tela (padrões UX de sempre)

- Conclusão da proposta: bloco "Assinatura digital" com um cartão por signatário (nome por extenso, status "aguardando / visualizou / assinou" com data), botão **Copiar link** e **Abrir WhatsApp** por signatário, aviso de recusa com motivo, botão reenviar (com aviso de custo).
- Ficha do contrato: PDF assinado para download + trilha (quem assinou, quando, por qual método).
- Início: fila "aguardando assinatura há mais de N dias".

---

## 4. Gargalos e alertas (numerados para decisão)

| # | Gargalo | Impacto | Encaminhamento |
|---|---------|---------|----------------|
| **G1** | **URL do PDF assinado expira em 60 minutos** e o sistema hoje **não tem armazenamento de arquivos** (anexos são metadados) | Sem storage, perdemos o acesso garantido ao contrato assinado | Resolver storage UMA vez (disco do VPS ou S3-compatível) — serve também para os anexos do Contas a Pagar. A fila baixa o PDF imediatamente ao receber o webhook final |
| **G2** | **Documento criado consome o plano mesmo se não for assinado**; excluir não devolve crédito; reenvio = documento novo | Custo por retrabalho | Criar o doc na ZapSign **só no clique "enviar para assinatura"** (nunca automático na formalização); avisar custo no botão de reenvio; dimensionar o plano por contratos+termos+acordos/mês |
| **G3** | **Assinatura automática da Azit exige add-on de assinatura em lote** no plano + usuário com assinatura cadastrada | Sem o add-on, a Azit assina manualmente NA PLATAFORMA ZapSign — fora do nosso sistema, quebra o "tudo em tela" | **Confirmar se o plano contratado tem o add-on.** Definir quem assina pela Azit (Diretor?) e cadastrar a assinatura desse usuário |
| **G4** | **`markdown_text`: o layout do PDF fica com a ZapSign** | Visual do contrato fora do nosso controle fino | Homologar o visual em sandbox primeiro; se não agradar, geramos PDF próprio e enviamos `base64_pdf` (mais trabalho, layout 100% nosso) |
| **G5** | **Webhook autenticado só por header estático** (sem HMAC) e com reenvios que duplicam | Segurança/idempotência | Header secreto próprio validado na borda + processamento idempotente na fila (padrão da casa) |
| **G6** | **Sandbox não tem validade jurídica** e produção consome plano | O teste "de verdade" custa documento | Homologação funcional toda em sandbox; reservar poucos documentos de produção para o teste final |
| **G7** | **Métodos de autenticação têm custo por assinatura** (SMS R$ 0,10; WhatsApp 5 créditos; selfie 15; face-match Serpro 35) | Custo variável por contrato | Começar com **assinatura na tela + CPF validado na Receita (grátis)**; método por produto parametrizável — subir para selfie/face-match se a área jurídica pedir |
| **G8** | **Dependência de serviço externo no balcão** | Cliente na frente do operador e ZapSign fora do ar | Fallback natural: link fica pendente e é enviado depois; a formalização não trava |
| **G9** | **LGPD: nome, CPF e telefone vão para um terceiro** (operador de dados) | Exposição de dados pessoais | Enviar o mínimo; `hide_email/hide_phone` no relatório quando fizer sentido; servidores BR existem só em plano dedicado (provavelmente desnecessário) |
| **G10** | **Migração dos contratos mock** | Contratos existentes assinados por botão | Permanecem válidos como estão; chave de virada liga a ZapSign só para formalizações novas |

---

## 5. Faseamento proposto (para quando autorizar o desenvolvimento)

1. **F1 — Fundação**: módulo assinatura + provider ZapSign + `DocumentoAssinatura` + webhook/fila + contrato do veículo (sem pacote), sandbox, chave de virada desligada.
2. **F2 — Pacote e Azit automática**: envelope com apartados; assinatura em lote da Azit; telas completas (cartões por signatário, links WhatsApp).
3. **F3 — Demais instrumentos**: termo do RP, acordo, novação (templates novos no motor).
4. **F4 — Balcão e aceites**: widget no modo balcão; OneClick para autorização de consulta e LGPD na análise.
5. **F5 — Storage definitivo** (pode vir antes, junto do G1): armazenamento de PDFs assinados + anexos do Contas a Pagar.

## 6. Decisões que precisam do Luís antes de construir

1. O plano ZapSign contratado inclui o **add-on de assinatura em lote**? (G3 — define se a Azit assina automática)
2. **Quem assina pela Azit** (qual usuário/diretor) — e cadastrar a assinatura dele na ZapSign.
3. **Método de autenticação do cliente** no contrato do veículo: começar grátis (tela + CPF Receita) ou já com selfie? (G7)
4. **Envio do link**: sempre pelo operador (grátis) ou automático via WhatsApp da ZapSign (R$ 0,50/envio)?
5. **Storage** (G1): disco do VPS ou S3-compatível?
