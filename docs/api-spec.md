# Especificação de API V3 — Azit Move
**Motor de Crédito: Contratos de Integração**
Versão: 1.1
Data: 2026-06-23

---

## 1. Convenções Gerais

- **Formato:** JSON em todas as requisições e respostas
- **Autenticação:** Bearer Token em todas as rotas
- **Datas:** ISO 8601 — `YYYY-MM-DD` para datas, `YYYY-MM-DDTHH:mm:ssZ` para timestamps
- **Valores monetários:** inteiros em centavos (ex: R$ 997,00 = `99700`)
- **CPF/CNPJ:** somente dígitos, sem pontuação (ex: `08430605657`)
- **Telefone:** formato E.164 sem `+` (ex: `5527999857602`)
- **Erros:** sempre retornam `{ "erro": "codigo", "mensagem": "descrição legível" }`
- **Paginação:** `page` e `limit` como query params; resposta inclui `total`, `page`, `limit`

---

## 2. API de Originação (nativa, operada em telas)

A originação acontece **dentro do sistema**, operada pelo operador em telas — não via API do PopHub (absorvido, não integrado). O funil completo (Lead → Simulação → Oferta → Proposta → Análise → Formalização → Ativação) é exposto por endpoints internos. Esta seção cobre os principais; o detalhamento das telas está no Doc 3 (seção 8-A) e no Doc 2 (fluxo 8.1).

### Endpoints do funil (resumo)

| Método | Rota | Função |
|---|---|---|
| `POST` | `/api/v1/leads` | Cria um Lead (pré-cadastro: nome, CPF, nascimento). Verifica reconciliação por CPF |
| `POST` | `/api/v1/simulacoes` | Cria uma simulação sobre um ativo; retorna ofertas calculadas |
| `POST` | `/api/v1/propostas` | Converte a oferta escolhida em proposta (status Pendente) |
| `PATCH` | `/api/v1/propostas/:id/status` | Move a proposta no funil (respeitando transições válidas) |
| `POST` | `/api/v1/propostas/:id/documentos` | Anexa documento digital (por papel) |
| `POST` | `/api/v1/propostas/:id/parecer` | Registra o parecer da análise (aprovado/ressalva/reprovado) |
| `POST` | `/api/v1/propostas/:id/formalizar` | Congela snapshot, gera contrato, cria ContratoCredito em Aguardando assinatura |
| `POST` | `/api/v1/contratos/:id/ativar` | Gera a primeira fatura (entrada) como cobrança avulsa no Asaas |

> **Reconciliação por CPF (Lead → Titular):** ao criar lead ou avançar proposta, o sistema verifica se já existe Titular com o CPF. Se sim, reaproveita; se não, na promoção cria o Titular. Leads são leves e podem duplicar; o Titular é único por CPF.

### POST `/api/v1/propostas/:id/formalizar`

Etapa que materializa o contrato a partir da proposta aprovada. Executa:
- Congela o **snapshot** (fotografia imutável de pessoas/papéis, ativo, condições, valores, oferta)
- Gera o documento do contrato via motor de templates (a partir do snapshot)
- Cria o `ContratoCredito` em **Aguardando assinatura**
- Gera o cronograma completo (parcelas, faturas futuras, recebíveis) no D0

O snapshot abaixo é a estrutura congelada (exemplo). Os mesmos dados que antes "chegavam do PopHub" agora nascem das telas e são consolidados aqui:

#### Snapshot de formalização (exemplo)

```json
{
  "contrato": {
    "numero_origem": "2026040001",
    "data_assinatura": "2026-04-06",
    "data_primeira_parcela": "2026-04-08",
    "periodicidade": "semanal",
    "indice_reajuste": "ipca",
    "taxa_multa_atraso": 2.00,
    "taxa_juros_atraso_mensal": 1.00,
    "taxa_desconto_quitacao_diaria": 0.033
  },

  "cliente": {
    "nome": "Samuel Antonio Gomes",
    "tipo_pessoa": "pf",
    "cpf_cnpj": "10464432677",
    "rg": "281039073",
    "estado_civil": "casado",
    "profissao": "Motorista de Aplicativo",
    "whatsapp": "5527992370005",
    "email": "samufdg@gmail.com",
    "endereco": "Rua São Mateus",
    "numero": "86",
    "complemento": "Casa",
    "bairro": "Ataíde",
    "cidade": "Vila Velha",
    "estado": "ES",
    "cep": "29119193",
    "asaas_customer_id": "cus_000167350365"
  },

  "papeis": [
    { "papel": "comprador_principal", "titular_id": "..." }
  ],

  "ativo": {
    "chassi": "9BHCP41AARP521695",
    "renavam": "01368167397",
    "placa": "SJC9I93",
    "marca": "Hyundai",
    "modelo": "HB20S",
    "ano_fabricacao": 2023,
    "ano_modelo": 2024,
    "cor": "Azul",
    "origem": "locadora",
    "combustivel": "flex",
    "quilometragem_entrada": 89801,
    "valor_aquisicao": 13260400
  },

  "itens_contratados": [
    {
      "tipo_produto": "parcelamento_veiculo",
      "natureza": "parcelado",
      "valor_total": 13060700,
      "valor_parcela": 99700,
      "numero_parcelas": 131,
      "credor": "azit"
    },
    {
      "tipo_produto": "protecao_veicular",
      "natureza": "recorrente",
      "valor": 5000,
      "credor": "azit"
    },
    {
      "tipo_produto": "taxa_servico",
      "natureza": "recorrente",
      "valor": 0,
      "credor": "azit"
    }
  ],

  "entrada": {
    "valor": 199700,
    "asaas_payment_id": "pay_abc123",
    "data_pagamento": "2026-04-06"
  }
}
```

#### Campos Obrigatórios
- `contrato.numero_origem` — identificador único do contrato (gerado na formalização)
- `contrato.data_assinatura`
- `contrato.data_primeira_parcela`
- `cliente.cpf_cnpj` — chave primária de identificação
- `cliente.nome`
- `cliente.whatsapp`
- `ativo.chassi` — chave primária de identificação do ativo
- `itens_contratados` — mínimo um item do tipo `parcelamento_veiculo`

> **Nota de nomenclatura:** o bloco `cliente` no snapshot designa o **titular** no papel de comprador principal. Internamente, o sistema trabalha com `Titular` (único por CPF/CNPJ), sua `Conta` e o `ContratoCredito`. O nome `cliente` é mantido no snapshot por clareza de leitura; a entidade é sempre o Titular com seu papel.

#### Campos Opcionais
- `papeis[]` com papel `garantidor` — presente apenas quando o contrato tem garantidor
- `cliente.asaas_customer_id` — preenchido **após** a ativação (cliente só é cadastrado no Asaas ao pagar a entrada)
- `itens_contratados[].credor_id` — obrigatório quando `credor = investidor` ou `credor = terceiro`

#### Response — 201 Created

```json
{
  "contrato_credito_id": "uuid-do-contrato-credito",
  "numero": "2026040001",
  "titular_id": "uuid-do-titular",
  "conta_id": "uuid-da-conta",
  "ativo_id": "uuid-do-ativo",
  "status": "ativo",
  "total_parcelas_geradas": 131,
  "total_faturas_geradas": 131,
  "proxima_fatura": {
    "id": "uuid-da-fatura",
    "data_vencimento": "2026-04-08",
    "valor_total": 104700
  }
}
```

#### Erros Comuns

| Código | Situação |
|---|---|
| `contrato_duplicado` | `numero_origem` já existe no sistema |
| `ativo_nao_encontrado` | Nenhum ativo com o chassi informado |
| `ativo_indisponivel` | Ativo já vinculado a outro contrato de crédito ativo |
| `titular_dados_insuficientes` | Campos obrigatórios do titular ausentes |
| `entrada_invalida` | `asaas_payment_id` não encontrado ou já conciliado |

---

### Garantidor como papel

Quando há garantidor, ele é um **Titular** vinculado à proposta/contrato com o papel `garantidor` (via VinculoPapel) — não uma entidade separada. No snapshot de formalização, o bloco do garantidor aparece preenchido com os dados daquele Titular no momento da assinatura:

```json
{
  "papeis": [
    { "papel": "comprador_principal", "titular_id": "..." },
    { "papel": "garantidor", "titular_id": "...",
      "snapshot": {
        "nome": "Vania Teodoro Moreira",
        "cpf": "07305936650",
        "whatsapp": "5531973047609",
        "cidade": "Vila Velha",
        "estado": "ES"
      }
    }
  ]
}
```

> O mesmo Titular nunca ocupa dois papéis no mesmo contrato (CPF único entre papéis).

---

### POST `/api/v1/contratos/:id/ativar` — sequência de ativação

A ativação é disparada pelo **pagamento da primeira cobrança da entrada**. Sequência:

1. Contrato assinado → sistema gera a **primeira Fatura** (a entrada), cobrada como **cobrança avulsa no Asaas** (o cliente ainda **não** está cadastrado no Asaas neste momento).
2. O `asaas_charge_id` da cobrança avulsa é **guardado e vinculado ao Titular** — referência que não pode se perder (senão a entrada fica órfã no espelho de pagamento).
3. Cliente paga → **webhook** `PAYMENT_RECEIVED` confirma.
4. A confirmação dispara: **ativa o ContratoCredito** (→ Ativo) + **cadastra o cliente no Asaas** (cliente pleno, agora) + registra o pagamento no espelho do titular.

> A entrada é a **primeira Fatura** do contrato (não uma cobrança à parte). Intermediárias (até 40%) entram como itens das faturas seguintes. No Asaas, só essa primeira é avulsa; as demais são cobradas com o cliente já cadastrado.

---

## 3. Webhooks do Asaas → Azit Move

O Asaas envia webhooks para o sistema em eventos de pagamento. O sistema deve processar e atualizar status em tempo real.

### POST `/api/v1/webhooks/asaas`

Endpoint receptor de todos os webhooks do Asaas.

> **Cobrança legada (doc 02 §26.5/§26.10):** quando `payment.externalReference` vem vazio, o
> handler procura `Fatura.asaasChargeId = payment.id` (as faturas migradas são amarradas à
> cobrança antiga) e, se achar, segue o fluxo normal de fatura. Só ignora (202) se não houver
> fatura amarrada.

#### Headers Esperados
```
asaas-access-token: {token-configurado-no-asaas}
Content-Type: application/json
```

#### Evento: Pagamento Confirmado — `PAYMENT_RECEIVED`

```json
{
  "event": "PAYMENT_RECEIVED",
  "payment": {
    "id": "pay_abc123",
    "customer": "cus_000167350365",
    "value": 104700,
    "netValue": 102500,
    "originalValue": 99700,
    "interestValue": 0,
    "fineValue": 0,
    "paymentDate": "2026-04-08",
    "dueDate": "2026-04-08",
    "status": "RECEIVED",
    "billingType": "PIX",
    "externalReference": "fatura_uuid"
  }
}
```

**Processamento pelo sistema:**
1. Identifica a fatura pelo `externalReference`
2. Calcula breakdown: `valor_nominal + encargo` se `paymentDate > dueDate`
3. Atualiza status da fatura: → Paga ou Paga em atraso
4. Atualiza status das parcelas vinculadas
5. Atualiza status do contrato se aplicável
6. Calcula e registra breakdown dos recebíveis
7. Atualiza posição do cliente na régua de cobrança

#### Evento: Pagamento Atrasado — `PAYMENT_OVERDUE`

```json
{
  "event": "PAYMENT_OVERDUE",
  "payment": {
    "id": "pay_abc123",
    "customer": "cus_000167350365",
    "value": 104700,
    "dueDate": "2026-04-08",
    "status": "OVERDUE",
    "externalReference": "fatura_uuid"
  }
}
```

**Processamento pelo sistema:**
1. Identifica a fatura
2. Atualiza fatura → Vencida
3. Atualiza contrato → Inadimplente
4. Ativa régua de cobrança para esta fatura

#### Evento: Entrada de Acordo Paga — `PAYMENT_RECEIVED` (acordo)

Mesmo evento de pagamento confirmado. O `externalReference` diferencia:
- `fatura_uuid` → pagamento de fatura normal
- `acordo_uuid` → pagamento de entrada de acordo

**Processamento para acordo:**
1. Identifica o acordo pelo `externalReference`
2. Efetiva o acordo:
   - Acordo: Rascunho → Ativo
   - Parcelas em atraso cobertas → recebem vínculo de acordo (NÃO status RENEGOCIADA)
   - ItemContratado de origem ACORDO gerado, com as novas parcelas → Em aberto
   - Contrato NÃO é liquidado; permanece com as demais parcelas inalteradas

#### Response Esperado pelo Asaas
```json
{ "received": true }
```
> Sempre retornar 200. Processar de forma assíncrona quando necessário.

---

## 4. API Interna — Endpoints Principais

Endpoints consumidos pelo front-end operacional e futuras interfaces de cliente e investidor.

---

### 4.1 Contratos

#### GET `/api/v1/contratos`
Lista contratos com filtros.

**Query params:** `status`, `titular_id`, `data_inicio`, `data_fim`, `page`, `limit`

**Response:**
```json
{
  "total": 76,
  "page": 1,
  "limit": 20,
  "data": [
    {
      "id": "uuid",
      "numero": "2026040001",
      "cliente": { "id": "uuid", "nome": "Samuel Antonio Gomes", "cpf_cnpj": "10464432677" },
      "ativo": { "placa": "SJC9I93", "modelo": "HB20S", "ano_modelo": 2024 },
      "status": "ativo",
      "data_assinatura": "2026-04-06",
      "valor_total": 13260400,
      "saldo_devedor_atual": 12063700,
      "parcelas_pagas": 3,
      "total_parcelas": 131,
      "proxima_fatura": { "data_vencimento": "2026-04-29", "valor": 104700 }
    }
  ]
}
```

#### GET `/api/v1/contratos/:id`
Detalhes completos de um contrato.

**Response:**
```json
{
  "id": "uuid",
  "numero": "2026040001",
  "status": "ativo",
  "data_assinatura": "2026-04-06",
  "data_primeira_parcela": "2026-04-08",
  "valor_total": 13260400,
  "valor_entrada": 199700,
  "saldo_devedor": 13060700,
  "saldo_devedor_atual": 12063700,
  "numero_parcelas": 131,
  "valor_parcela_inicial": 99700,
  "periodicidade": "semanal",
  "taxa_desconto_quitacao_diaria": 0.033,
  "cliente": { },
  "ativo": { },
  "itens_contratados": [ ],
  "acordos": [ ]
}
```

#### GET `/api/v1/contratos/:id/parcelas`
Cronograma completo de parcelas.

**Query params:** `status`, `page`, `limit`

**Response:**
```json
{
  "total": 131,
  "data": [
    {
      "id": "uuid",
      "numero": 1,
      "total_parcelas": 131,
      "display": "1/131",
      "item_contratado": { "tipo_produto": "parcelamento_veiculo" },
      "valor_nominal": 99700,
      "data_vencimento": "2026-04-08",
      "status": "paga",
      "data_pagamento": "2026-04-08",
      "valor_pago": 99700,
      "valor_encargo": 0,
      "fatura_id": "uuid"
    }
  ]
}
```

#### GET `/api/v1/contratos/:id/faturas`
Histórico de faturas do contrato.

#### GET `/api/v1/contas/:contaId/faturas?visao=agora|vencer|pagas|outras&offset&limit`
Faturas da conta por **visão** (ficha do titular, doc 02 §33.2; substitui a paginação por `page` e
o filtro `novadas`, 18/11/2026). `agora` (padrão) = disponíveis e vencidas, devolvida inteira;
`vencer` = ainda não disponíveis; `pagas` = quitadas, da mais recente para a mais antiga; `outras` =
renegociadas, novadas e rescindidas. Resposta: `{ "visao", "total", "offset", "data": [fatura] }` —
`offset` é quantas já estão na tela ("carregar mais"); `limit` padrão 10, máximo 50.

Cada fatura leva `valorPago` (o que entrou nela), `faltaHoje` e `encargoHoje`. `faltaHoje`: em
fatura do modelo AZIT fechada é o total do motor (saldo + multa + atualização, a mesma conta da
página do cliente) e `encargoHoje` é a parte de multa e atualização; nas demais em aberto, valor da
fatura menos o pago mais a multa e a atualização de hoje (`encargoHojeDaFatura`, a mesma função da
página do cliente); `null` em fatura que não está em aberto.

#### GET `/api/v1/contas/:contaId/posicao`
Posição de hoje da conta (doc 02 §33.1), calculada na leitura: `{ "hoje", "atraso": { "faturas",
"valorHoje", "encargos", "diasMaisAntiga" }, "proxima": { "id", "numero",
"dataVencimento", "valor", "disponivel" } | null, "ultimoPagamento": pagamento | null,
"faturaComLinkId", "trilho": { "pagas", "emAtraso", "valorEmAtraso", "aVencer", "valorAVencer" },
"contagem": { "agora", "vencer", "pagas", "outras" } }`. Centavos.

#### GET `/api/v1/contas/:contaId/pagamentos?offset&limit`
Cada dinheiro que entrou na conta, do mais recente para o mais antigo (doc 02 §33.3):
`{ "total", "offset", "data": [{ "id", "dia": "AAAA-MM-DD", "hora": "HH:MM" | null, "tipo":
"pix|cobranca|sinistro|entrada_contrato|entrada_acordo", "valor", "excedente", "descricao",
"contratoNumero", "acordoId", "destinos": [{ "faturaId", "numero", "valor", "encargos", "quitou" }] }] }`.
Um Pix que cobre mais de uma fatura vem uma vez, com um destino por fatura.

`GET /api/v1/titulares/:id` passa a trazer `conta.situacao` (`sem_contrato_ativo | bloqueada |
em_atraso | em_acordo | em_dia`) — a mesma regra da grade de clientes da carteira.

#### POST `/api/v1/titulares/:id/creditos` — Reembolso Parcelado pelo "de acordo" (doc 02 §18.7, 18/11/2026)
Contratação avulsa pela ficha do titular; vai para a Central de Aprovações. Além de `descricao`,
`valor`, `numeroParcelas` e `fornecedorId`, o corpo aceita `aceiteWhatsapp` (boolean),
`mensagemWhatsapp`, `respostaCliente` e `observacao`. No Reembolso Parcelado `aceiteWhatsapp: true`
é obrigatório (422 `sem_aceite_cliente`); o aceite fica em `snapshotJson.aceiteWhatsapp` do contrato.
Aprovado na Central, o reembolso ativa na hora — não há mais termo nem assinatura.

#### POST `/api/v1/creditos/:id/de-acordo`
Reembolso Parcelado aprovado antes de 18/11 e parado em "aguardando assinatura": registra o "de
acordo" (`{ "aceiteWhatsapp": true, "respostaCliente"?, "mensagemWhatsapp"? }`), cancela o termo em
aberto e ativa (cronograma + título ao fornecedor). 422 `estado_invalido` fora desse caso.
Resposta: `{ "contratoId", "numero", "status": "ativo" }`.

`GET /api/v1/contratos/:id/documento`: em contrato fechado por "de acordo", o texto devolvido é o
registro do aceite (quem registrou, mensagem enviada e resposta do cliente).

#### GET `/api/v1/contratos/:id/extrato`
Extrato completo do contrato — todos os eventos financeiros em ordem cronológica.

#### GET `/api/v1/contratos/:id/quitacao`
Simula valor de quitação antecipada.

**Query params:** `data_referencia` (default: hoje), `parcelas_ids` (opcional — para quitação parcial)

**Response:**
```json
{
  "data_referencia": "2026-06-23",
  "modalidade": "total",
  "parcelas_restantes": 128,
  "valor_nominal_total": 12763600,
  "valor_presente_total": 11234500,
  "desconto_total": 1529100,
  "taxa_diaria_aplicada": 0.033,
  "detalhamento": [
    {
      "parcela_id": "uuid",
      "display": "4/131",
      "data_vencimento": "2026-04-29",
      "valor_nominal": 99700,
      "dias_antecipados": 6,
      "valor_presente": 99501
    }
  ]
}
```

---

### 4.2 Faturas

#### GET `/api/v1/faturas`
Lista faturas com filtros.

**Query params:** `status`, `conta_id`, `contrato_id`, `data_vencimento_inicio`, `data_vencimento_fim`, `page`, `limit`

#### POST `/api/v1/faturas/:id/conferir-pagamento`
Consulta a cobrança da fatura no Asaas (`GET /payments/{asaasChargeId}`) e, se estiver recebida (`RECEIVED`, `CONFIRMED`, `RECEIVED_IN_CASH`), enfileira a mesma conciliação do webhook com valor e data reais (doc 02 §7.3, 02/10). Papéis: admin, operador, financeiro, diretor.

**Response:** `{ enfileirado: boolean, statusAsaas: string | null, motivo: string | null }` — `enfileirado: false` traz o motivo (fatura já paga; Asaas ainda sem recebimento). 422 `sem_cobranca` (fatura sem cobrança no Asaas) / `asaas_simulado`.

#### GET `/api/v1/faturas/:id`
Detalhes de uma fatura com todos os itens.

**Response:**
```json
{
  "id": "uuid",
  "numero": 4,
  "status": "fechada",
  "data_fechamento": "2026-04-24",
  "data_vencimento": "2026-04-29",
  "valor_total": 104700,
  "asaas_charge_id": "pay_abc123",
  "itens": [
    {
      "id": "uuid",
      "parcela_id": "uuid",
      "tipo": "principal",
      "descricao": "Parcelamento do veículo — 4/131",
      "valor": 99700,
      "credor": "azit"
    },
    {
      "id": "uuid",
      "parcela_id": "uuid",
      "tipo": "servico",
      "descricao": "Proteção veicular",
      "valor": 5000,
      "credor": "azit"
    }
  ]
}
```

---

### 4.3 Inadimplência

#### GET `/api/v1/inadimplencia/painel`
Visão em tempo real de todos os clientes em situação de inadimplência, agrupados por estágio na régua.

**Response:**
```json
{
  "atualizado_em": "2026-06-23T14:32:00Z",
  "resumo": {
    "d0": { "quantidade": 3, "valor_total": 314100 },
    "d1_d2": { "quantidade": 5, "valor_total": 523500 },
    "d3_bloqueado": { "quantidade": 2, "valor_total": 209400 },
    "d10_notificado": { "quantidade": 1, "valor_total": 104700 },
    "d12_recuperacao": { "quantidade": 1, "valor_total": 104700 }
  },
  "clientes": [
    {
      "contrato_id": "uuid",
      "numero_contrato": "2026040001",
      "cliente": { "nome": "Samuel Antonio Gomes", "whatsapp": "5527992370005" },
      "ativo": { "placa": "SJC9I93" },
      "dias_atraso": 3,
      "estagio_regua": "d3_bloqueado",
      "valor_em_aberto": 104700,
      "faturas_vencidas": 1,
      "status_contrato": "bloqueado"
    }
  ]
}
```

> **Implementado (31/10):** `GET /api/v1/regua` devolve um array de itens `{ id, numero, contaId,
> bloqueado, emRecuperacao, diasAtraso, estagio, valorVencido, parcelasVencidas, valorVenceHoje,
> parcelasVenceHoje, bloqueioDisponivel, titular { nome, cpfCnpj }, ativo { placa, modelo } | null }`
> (centavos). Entram contratos ATIVOS com atraso ≥ 1 dia, com parcela vencendo hoje
> (`parcelasVenceHoje > 0`, raia "Vence hoje") ou em intervenção. A raia é calculada na tela por
> `resolverRaiaRegua(diasAtraso, parcelasVenceHoje > 0)` (@azit/utils); `bloqueioDisponivel` =
> `diasAtraso >= DIAS_BLOQUEIO_DISPONIVEL` (8 — raia "até 14 dias"); `POST /contratos/:id/bloquear`
> responde 422 `antes_da_raia_de_bloqueio` abaixo disso.

#### POST `/api/v1/contratos/:id/bloquear`
Registra o bloqueio do veículo no sistema (ação manual do operador).

**Body:**
```json
{
  "motivo": "inadimplencia",
  "operador_id": "uuid",
  "observacao": "D+3 sem pagamento. Veículo localizado em Vila Velha."
}
```

#### POST `/api/v1/contratos/:id/desbloquear`
Registra o desbloqueio do veículo após regularização (ação manual do operador).

**Body:**
```json
{
  "operador_id": "uuid",
  "observacao": "Pagamento confirmado. Veículo liberado."
}
```

---

### 4.4 Acordo e Novação

#### GET `/api/v1/contratos/:id/obrigacoes-abertas`
Lista todas as obrigações em atraso do contrato para seleção no acordo.

**Response:**
```json
{
  "saldo_total_em_aberto": 314100,
  "por_fatura": [
    {
      "fatura_id": "uuid",
      "numero": 30,
      "data_vencimento": "2026-03-18",
      "dias_atraso": 14,
      "valor_total": 104700,
      "itens": [
        { "parcela_id": "uuid", "descricao": "Parcelamento — 30/131", "valor": 99700 },
        { "parcela_id": "uuid", "descricao": "Proteção veicular", "valor": 5000 }
      ]
    }
  ]
}
```

#### POST `/api/v1/acordos`
Cria um acordo (recuperação branda) em rascunho. Dilui parcelas em atraso sem liquidar o contrato.

**Body:**
```json
{
  "contrato_id": "uuid",
  "operador_id": "uuid",
  "obrigacoes_selecionadas": {
    "faturas_ids": ["uuid-fatura-30", "uuid-fatura-31"],
    "parcelas_ids": []
  },
  "valor_entrada": 94230,
  "numero_parcelas_novas": 12,
  "valor_parcela_nova": 18323,
  "observacao": "Cliente pagará entrada até 26/06. Acordo em 12 semanas."
}
```

**Response — 201 Created:**
```json
{
  "acordo_id": "uuid",
  "status": "rascunho",
  "valor_total_renegociado": 209400,
  "valor_entrada": 94230,
  "numero_parcelas_novas": 12,
  "valor_parcela_nova": 18323,
  "asaas_charge_id_entrada": "pay_entrada_xyz",
  "link_pagamento_entrada": "https://asaas.com/c/abc123",
  "obrigacoes_cobertas": {
    "faturas": ["uuid-fatura-30", "uuid-fatura-31"],
    "parcelas": ["uuid-p30a", "uuid-p30b", "uuid-p31a", "uuid-p31b"]
  }
}
```

#### GET `/api/v1/acordos`
Lista de acordos (acompanhamento). Desde 21/10 cada linha traz `origem` (`nativo` | `legado` —
importado pela migração do Asaas, doc 02 §26.15), `contratos[]` (`{ id, numero, descricao, placa }`),
`contaId`, `criadoPor` e `periodicidade`, além de totais/entrada/plano em centavos.

#### GET `/api/v1/acordos/:id`
Detalhe do acordo — a tela Renegociações mostra ao clicar (feedback Luís 21/10: "quantas parcelas
o acordo engloba, quais foram, o que tinha nelas"). Dinheiro em centavos; datas-calendário
`YYYY-MM-DD`; instantes em ISO. Nada é lido do caso de migração: o acordo legado sai com o MESMO
detalhe a partir do que a migração gravou (parcelas com `acordoId`, faturas RENEGOCIADAS, lançamentos).

| Campo | Conteúdo |
|---|---|
| `plano` | `valorTotalRenegociado`, `valorEntrada`, `numeroParcelasNovas`, `valorParcelaNova`, `periodicidade`, `totalPlano` (= N × parcela) |
| `faturasCobertas[]` | fatura em que cada parcela coberta estava: `numero`, `dataVencimento`, `status`, `valorTotal`, `diasAtrasoNaDataBase`, `itens[]` (`descricao`, `tipo`, `valor`, `credor`, `coberto` = item é de parcela coberta) e `parcelas[]` (`display`, `contratoNumero`, `produto`, `dataVencimento`, `valorNominal`, `diasAtrasoNaDataBase`, `status` = rótulo "Em acordo"…) |
| `totaisCobertura` | `quantidadeParcelas`, `quantidadeFaturas`, `valorNominal`, `encargosMora` e `valorAtualizado` do snapshot (null no legado), `moraHerdada` |
| `cotas[]` | parcelas novas do item ACORDO: `display`, `contratoNumero`, `dataVencimento`, `valorNominal`, `status` (rótulo runtime — Regra 7), `dataPagamento`, `valorPago`, `valorEncargo`, `fatura { numero, dataVencimento, status }` |
| `resumoCotas` | `quantidade`, `pagas`, `vencidas`, `venceHoje`, `aVencer`, `novadas`, `valorPago` (sem juros), `encargosPagos`, `valorAPagar`, `valorVencido`, `totalPlano` |
| `entrada` | `valor`, `dataLimite`, `pagaEm`, `cobrancaAsaasId`, `situacao` (`sem_entrada` / `paga` / `aguardando` / `aguardando_aprovacao` / `expirada` / `nao_paga`) |
| `exclusoes[]`, `vincendasIncluidas[]` | seleção do snapshot resolvida para `numero`/`dataVencimento`/`valorTotal` da fatura; exclusão traz `justificativa` |
| `calculo` | prévia congelada (motor `catalogo` ou `placeholder`, taxas, saldo a parcelar, total, exceções) ou null |
| `aprovacao` | solicitação na Central: `status`, `resumo`, `solicitante`, `decisoes[]` (`usuario`, `decisao`, `parecer`, `em`) |
| `trilha[]` | eventos humanos em ordem: `em`, `titulo`, `por`, `detalhe` — proposta → Central → cobrança da entrada → entrada paga → efetivado → cumprido / novado / cancelado / expirado; legado: "firmado no legado" + "importado pela migração" |
| `legado` | `casoId`, `parcelasCobertasDeclaradas[]`, `primeiraCotaEm`, `ultimaCotaEm` (null no nativo) |
| `novacaoId` | novação que absorveu o acordo (status `novado`) |

#### GET `/api/v1/novacoes/:id`
Detalhe da novação (21/10): `origens[]` (contratos encerrados por novação com `parcelasNovadas`,
`valorNominalNovado`, `acordosNovados[]`, `encerradoEm`), `faturasNovadas`, `termos` (o que o
operador escolheu: prazo, frequência, desconto, acréscimo, troca, 1ª parcela), `simulacao`
(congelada — mesma forma de `POST contas/:id/novacao/simular`), `contratoVeiculo` e
`contratoTermo` (`numero`, `status`, plano, 1ª parcela, `cronograma { total, pagas, vencidas,
aVencer, proximoVencimento }`, `assinatura { status, enviadoEm, concluidoEm, signatarios[] }` —
o instrumento é um só, anexado ao contrato do veículo), `recebimentoInicial` (`valor`,
`cobrancaAsaasId`, `pagoEm`, `situacao`), `aprovacao` e `trilha[]` (proposta → Central →
contratos criados → instrumento enviado → assinaturas → recebimento → ativada / cancelada /
expirada; inclui alterações da 1ª parcela do log de auditoria).

`GET /api/v1/contratos/:id` passou a trazer `novacaoOrigemId` (contrato encerrado por novação →
link para o detalhe).

#### PATCH `/api/v1/acordos/:id/cancelar`
Cancela um acordo em rascunho.

#### PATCH `/api/v1/novacoes/:id/primeira-parcela`
Troca a data da 1ª parcela do contrato novo enquanto a novação está *Aguardando assinatura* e
ninguém assinou (doc 02 §7.7b, 15/10). Body `{ "dataPrimeiraParcela": "AAAA-MM-DD" }` (futuro).
Efeito: grava a data nos contratos novos (Termo e veículo), congela no snapshot, regenera o
instrumento, cancela o documento anterior na ZapSign e reenvia. Resposta:
`{ dataPrimeiraParcela, assinatura: { reenviada, motivo } }`. A simulação (`POST contas/:id/novacao/simular`)
e a proposta aceitam `dataPrimeiraParcela` opcional e devolvem `dataPrimeiraParcela` e
`dataPrimeiraParcelaPadrao` (próximo ciclo da conta); `GET /novacoes` traz `primeiraParcela`,
`frequencia`, `assinaturaStatus` e `podeAlterarPrimeiraParcela`.

#### POST `/api/v1/novacoes`
Cria uma **novação** (recuperação radical) — mecanismo distinto do acordo. Liquida o contrato inteiro e gera um novo.

**Body:**
```json
{
  "contrato_origem_id": "uuid",
  "operador_id": "uuid",
  "saldo_liquidado": 280000,
  "novas_condicoes": {
    "numero_parcelas": 160,
    "valor_parcela": 2100,
    "data_primeira_parcela": "2026-07-01"
  },
  "observacao": "Acordos não recuperaram; novação antes da retomada."
}
```

**Efeito na efetivação:**
- Contrato origem → `LIQUIDADO_POR_NOVACAO` (terminal, preservado para auditoria)
- Novo ContratoCredito criado, com cronograma novo no D0
- Registro `Novacao` vincula origem e novo

---

### 4.5 Reajuste IPCA

#### GET `/api/v1/reajustes/pendentes`
Lista contratos com reajuste IPCA pendente de aprovação.

#### GET `/api/v1/reajustes/:id`
Detalhes de um evento de reajuste — índice, valor anterior, valor novo, impacto.

#### POST `/api/v1/reajustes/:id/aprovar`
Aprova e aplica o reajuste. Atualiza parcelas futuras e registra data de notificação ao cliente.

**Body:**
```json
{
  "operador_id": "uuid",
  "observacao": "IPCA acumulado 12 meses: 4,83%"
}
```

#### POST `/api/v1/reajustes/:id/cancelar`
Cancela o reajuste pendente.

---

### 4.6 Quitação Antecipada

#### POST `/api/v1/contratos/:id/quitar`
Executa a quitação antecipada após confirmação de pagamento.

**Body:**
```json
{
  "modalidade": "parcelas_especificas",
  "parcelas_ids": ["uuid-p10", "uuid-p11", "uuid-p12"],
  "data_pagamento": "2026-06-23",
  "asaas_payment_id": "pay_xyz",
  "valor_pago": 298503
}
```

**Modalidades:**
- `parcelas_especificas` — requer `parcelas_ids`
- `total` — quita todas as parcelas restantes
- `encerramento` — quitação total + registra transferência do ativo

---

### 4.7 Sinistro

#### POST `/api/v1/contratos/:id/sinistro`
Registra um sinistro no sistema.

**Body:**
```json
{
  "tipo": "perda_total",
  "data_ocorrencia": "2026-06-20",
  "descricao": "Colisão frontal. Perda total declarada pela seguradora.",
  "operador_id": "uuid"
}
```

#### POST `/api/v1/contratos/:id/sinistro/:sinistro_id/indenizacao`
Registra o recebimento da indenização e aplica amortização.

**Body:**
```json
{
  "valor_indenizacao": 9500000,
  "data_recebimento": "2026-06-23",
  "seguradora": "Porto Seguro",
  "observacao": "Indenização de perda total. Saldo remanescente: R$ 2.634,00"
}
```

---

### 4.8 Titulares e Contas

#### GET `/api/v1/titulares`
Lista titulares com filtros.

**Query params:** `nome`, `cpf_cnpj`, `status`, `page`, `limit`

#### GET `/api/v1/titulares/:id`
Perfil completo do titular.

#### GET `/api/v1/titulares/:id/contratos-credito`
Todos os contratos de crédito do titular (o que ele deve).

#### GET `/api/v1/titulares/:id/contratos-investimento`
Todos os contratos de investimento do titular (o que a Azit lhe deve).

#### GET `/api/v1/contas/:id/visao-geral`
Visão consolidada da conta — agrega os dois lados: saldo devedor total e contratos de crédito ativos (lado cliente), capital aportado e rendimento acumulado (lado investidor), próximos vencimentos e histórico.

> A mesma conta pode ter contratos de crédito e de investimento. A visão-geral retorna os dois blocos; o front-end exibe o módulo correspondente conforme o que a conta possui.

---

### 4.9 Ativos

#### GET `/api/v1/ativos`
Lista ativos com filtros.

**Query params:** `status`, `oferecivel` (`true` = Disponível + Em preparação, doc 02 §25.8 — usado pela vitrine
da simulação, pelo painel das Conversas e pela atribuição da lista de espera), `tipo` (`veiculo` | `outro`), `placa`,
`chassi`, `busca`, `page`, `limit`.

Todo ativo devolvido (lista, detalhe, frota, ficha) traz `preparacao`: `null` ou o alerta da preparação aberta
`{ preparacaoId, oQueFalta, pendentes: ["Instalação do rastreador"], totalItens, abertaEm }`. `status` pode ser
`em_preparacao` (doc 02 §25.8).

#### POST `/api/v1/ativos`
Cadastra um novo ativo no sistema. **Veículo novo nasce `em_preparacao`** com a cópia do checklist (motivo
`entrada`, auditoria `ativo_preparacao_aberta`); ativo do tipo `outro` não muda.

#### GET `/api/v1/ativos/:id`
Detalhes do ativo.

#### PATCH `/api/v1/ativos/:id`
Atualiza dados do ativo (ex: quilometragem, observação). **O status não é aceito** (doc 02 §25.7):
muda sozinho com o contrato, a reserva e o sinistro. Mudança de `observacao` grava
`logs_auditoria` (`ativo_observacao_alterada`).

#### GET `/api/v1/ativos/frota` *(doc 02 §25.7)*
Lista da frota (só veículos), paginada. **Query:** `filtro` (`disponivel` | `em_preparacao` | `reservado` |
`em_contrato` | `transferido` | `recuperado` | `sinistrado` | `com_pendencia`), `busca` (placa,
chassi, modelo, cliente ou número do contrato), `offset` (padrão 0), `limit` (padrão 20, máx. 100).
Cada linha é o ativo de `GET /ativos` mais:
```json
{ "contrato": { "id": "…", "numero": "2026030014", "contaId": "…", "situacao": "em_atraso", "diasAtraso": 9, "bloqueioDisponivel": true, "bloqueadoEm": null },
  "pendencias": { "quantidade": 2, "valor": 32546, "proximoPrazo": { "tipo": "vencimento", "data": "2026-11-22" } },
  "retorno": { "investido": 5385000, "recebido": 3630710, "aReceber": 10222463, "percentual": 67 } }
```
Resposta: `{ total, offset, limit, data: [...] }`. Valores em centavos.

#### GET `/api/v1/ativos/frota/resumo`
Indicadores do topo: `{ total, porStatus: { em_contrato: 66, … }, comPendencia: { veiculos, ocorrencias, valor }, investido, recebido, percentual }`.

#### GET `/api/v1/ativos/:id/ficha`
Ficha do veículo: `ativo` (com `ofertaFixa` e `fipe`), `comQuemEsta` (titular, contrato e desde
quando, mais a situação acima; `null` sem contrato ativo), `pendencias`, `retorno`, `observacao`
(`texto`, `alteradaEm`, `alteradaPor`), `custos` (aquisição, lançamentos com `origem`: manual ou
ocorrência assumida), `contratos` (todos os do veículo, com recebido e em aberto) e `preparacao`
(`{ aberta, anteriores }`, o mesmo de `GET /ativos/:id/preparacao`).

#### Preparação do veículo *(doc 02 §25.8, decisão Luís 24/11/2026)*
Única exceção ao status automático: o carro entra e sai de `em_preparacao` só por estas ações, auditadas. Escrita:
**ADMIN e OPERADOR** (o modelo do checklist: só ADMIN). Todas as escritas devolvem `{ aberta, anteriores }`.

- `GET /ativos/:id/preparacao` → `{ aberta: Preparacao | null, anteriores: Preparacao[] }`. `Preparacao` =
  `{ id, motivo: entrada|recuperacao|manutencao, oQueFalta, abertaEm, abertaPor, concluidaEm, concluidaPor,
  itens: [{ id, descricao, avulso, situacao: feito|nao_se_aplica|null, marcadoEm, marcadoPor }], pendentes }`.
- `POST /ativos/:id/liberar-para-venda` `{ oQueFalta? }` — Recuperado → Em preparação (motivo `recuperacao`).
  422 `status_invalido` fora de Recuperado; 422 `ja_em_preparacao`; 422 `nao_e_veiculo`.
- `POST /ativos/:id/preparacao` `{ oQueFalta? }` — Disponível → Em preparação (motivo `manutencao`). Mesmos 422.
- `POST /ativos/:id/preparacao/itens` `{ descricao }` — item só deste carro (`avulso: true`). 422 `sem_preparacao`.
- `PATCH /ativos/preparacao/itens/:itemId` `{ situacao: "feito" | "nao_se_aplica" | null }` — marca ou desmarca
  (auditoria `ativo_preparacao_item`). 422 `preparacao_concluida`.
- `DELETE /ativos/preparacao/itens/:itemId` — só item avulso (422 `item_do_modelo`: marque "não se aplica").
- `POST /ativos/:id/preparacao/concluir` — **Marcar como pronto**: exige todos os itens resolvidos (422
  `checklist_incompleto`); o carro vira Disponível (ou continua Reservado, se preso à lista de espera). Auditoria
  `ativo_preparacao_concluida`.
- `GET /ativos/preparacao/modelo` → `[{ id, descricao }]` (Configuração › Checklist de preparação).
- `PUT /ativos/preparacao/modelo` `{ itens: [{ id?, descricao }] }` (ADMIN) — salva a lista inteira na ordem dada;
  itens que saíram são desativados; preparações já abertas não mudam; lista vazia → 422 `modelo_vazio`. Auditoria `checklist_preparacao_alterado`.

**No funil:** `POST /simulacoes` e a atribuição da lista de espera aceitam carro Disponível ou Em preparação;
`GET /propostas/:id` traz `preparacaoVeiculo` (alerta + `motivo`, o texto da trava) e `GET /propostas/lista-espera` traz
`preparacaoVeiculo` por proposta; o dossiê da análise traz `veiculo.preparacao`. A **formalização** com preparação
aberta responde 422 `veiculo_em_preparacao` (mensagem = `motivo`). A troca de veículo da novação continua exigindo
Disponível. Se a reserva da lista de espera cai, o carro volta para Em preparação quando o checklist ainda está aberto.

---

### 4.10 Autenticação e acessos *(doc 06 v1.1 §2, §10 — bloco 2, 13/11/2026)*

Rotas públicas (`@Public`, `@AreaLivre`). Toda falha de entrada responde o **mesmo** 401 (§5), e o motivo
real fica só no registro de acessos (`acessos_usuario`).

#### GET `/api/v1/auth/config`
O que a tela de login precisa antes de qualquer credencial.
```json
{ "googleClientId": "43681993535-….apps.googleusercontent.com",   // null = botão do Google não aparece
  "senhaDisponivel": true }                                        // false = ninguém ativo com permiteSenha → "entrar com senha" não aparece
```

#### POST `/api/v1/auth/google` — entrar com Google (caminho normal)
Limite por IP: 10/min → 429. **Body:** `{ "credential": "<ID token do Google Identity Services>" }`.
Valida assinatura/`aud`/`iss`/`exp`/`email_verified`; `hd` e domínio do e-mail em `DOMINIOS_WORKSPACE`;
localiza o Usuario ativo pela **parte local** do e-mail; grava `googleSub` no 1º acesso e exige igualdade depois.
**Resposta (200):** a mesma do login por senha — `{ accessToken, refreshToken, usuario: { id, nome, email, roles } }`.
Sem `GOOGLE_CLIENT_ID` no ambiente: `503 google_nao_configurado`.

#### POST `/api/v1/auth/login` — entrar por senha (reserva, só com `permiteSenha`)
Limite por IP: 10/min → 429. Bloqueio temporário por usuário: 10 falhas seguidas → 15 min (não revelado).
**Body:** `{ email, senha }` — o e-mail também aceita os dois domínios do Workspace.

#### POST `/api/v1/auth/refresh` · POST `/api/v1/auth/logout` · GET `/api/v1/auth/me`
Inalterados; falha de refresh registra acesso `REFRESH` sem sucesso.

#### Minha conta (autenticado, `@AreaLivre`)
- `GET /api/v1/me/acessos` → `{ acessos: Acesso[50], sessoesAtivas, entrada: { permiteSenha, googleVinculado, email } }`
- `POST /api/v1/me/encerrar-sessoes` → `{ encerradas }` (revoga todos os refresh tokens do próprio usuário)

```json
// Acesso
{ "id": "…", "forma": "GOOGLE|SENHA|REFRESH", "sucesso": true, "motivo": null,
  "ip": "203.0.113.10", "agente": "Mozilla/5.0 …", "em": "2026-11-13T11:02:33.000Z" }
```

#### Usuários e permissões (área CONFIGURACOES)
- `GET /api/v1/usuarios` — cada linha agora traz `permiteSenha`, `temSenha`, `googleVinculado`, `ultimoAcessoEm`.
- `POST /api/v1/usuarios` — `{ nome, email, papeis, permiteSenha?: false, senha? }`: senha só vai (e é exigida, mín. 10) quando `permiteSenha` for `true`; só ADMIN liga; recusa a mesma caixa do Workspace nos dois domínios (`400 email_em_uso`).
- `PATCH /api/v1/usuarios/:id/permite-senha` (ADMIN) — `{ permiteSenha, motivo }` (motivo ≥ 5 caracteres) → `{ permiteSenha, temSenha }`; auditoria `usuario_permite_senha_alterado` com antes/depois.
- `POST /api/v1/usuarios/:id/senha` — `{ senha }` (mín. 10); `422 senha_desligada` se `permiteSenha` estiver desligado.
- `POST /api/v1/usuarios/:id/religar-google` (ADMIN) — zera `googleSub` e encerra as sessões; auditoria `usuario_google_religado`.
- `POST /api/v1/usuarios/:id/encerrar-sessoes` → `{ encerradas }`; auditoria `usuario_sessoes_encerradas`.
- `GET /api/v1/usuarios/:id/acessos` → `{ acessos: Acesso[50], sessoesAtivas }` (com o motivo interno).
- Auto-bloqueio (doc 06 §13.3): `PUT /permissoes/matriz`, `PUT /usuarios/:id/permissoes`, `PATCH /usuarios/:id` (papéis/ativo) e `DELETE /usuarios/:id` respondem `422 sem_admin_configuracoes` quando a mudança deixaria o sistema sem administrador ativo com a área Configurações.

---

## 5. Modelos de Erro

### Erros de Validação — 400 Bad Request
```json
{
  "erro": "validacao",
  "mensagem": "Dados inválidos na requisição",
  "campos": [
    { "campo": "cliente.cpf_cnpj", "mensagem": "CPF inválido" },
    { "campo": "ativo.chassi", "mensagem": "Campo obrigatório" }
  ]
}
```

### Sem Acesso à Área — 403 Forbidden *(doc 06 §7.5, v1.1)*
Toda rota autenticada pertence a uma ou mais áreas de trabalho (`@Area`, mapa no doc 06 §13). Quem não
tem nenhuma delas recebe este corpo, qualquer que seja o papel. `area` é a área dona da rota (código do
enum `AreaSistema`); `mensagem` já traz o nome por extenso (`NOME_AREA` de `@azit/types`). O frontend
trata no interceptor do axios e mostra "Sem acesso à área X — peça ao administrador".
```json
{
  "erro": "acesso_negado",
  "mensagem": "Sem acesso à área Análise de cadastro",
  "area": "ANALISE_CADASTRO"
}
```
O mesmo `erro: "acesso_negado"` **sem** `area` continua sendo a negação por papel (`@Roles`, doc 06 §7.3):
`{ "erro": "acesso_negado", "mensagem": "Você não tem permissão para esta operação" }`.

### Falha de entrada — 401 Unauthorized *(doc 06 v1.1 §2.4, §11.3)*
Uma resposta só para `POST /auth/login` e `POST /auth/google`, qualquer que seja a causa (e-mail inexistente,
senha errada, senha desligada, conta fora do domínio, conta Google divergente, usuário inativo, bloqueio
temporário). O motivo fica no registro de acessos, visível ao Admin em Usuários e permissões.
```json
{ "erro": "credenciais_invalidas", "mensagem": "Não foi possível entrar. Confira a conta usada ou fale com o administrador." }
```

### Muitas tentativas — 429 Too Many Requests *(doc 06 v1.1 §2.5)*
Limite por IP nas rotas de entrada: 10 por minuto em cada uma (`/auth/login`, `/auth/google`).
```json
{ "erro": "muitas_tentativas", "mensagem": "Muitas tentativas de entrada. Aguarde um minuto e tente de novo." }
```

### Regra que não pode ser quebrada — 422 Unprocessable Entity
Mudança válida na forma, mas que violaria uma invariante do sistema. Casos: `sem_admin_configuracoes`
(auto-bloqueio, doc 06 §13.3) e `senha_desligada` (redefinir senha de quem não tem a entrada por senha ligada).
```json
{ "erro": "sem_admin_configuracoes", "mensagem": "Esta alteração deixaria o sistema sem administrador ativo com a área Configurações — conceda a área (ou o papel) a outro usuário antes" }
```

### Integração não configurada — 503 Service Unavailable
`POST /auth/google` sem `GOOGLE_CLIENT_ID` no ambiente (a tela nem mostra o botão — `GET /auth/config` devolve `googleClientId: null`).
```json
{ "erro": "google_nao_configurado", "mensagem": "Entrada pelo Google não configurada neste ambiente" }
```

### Recurso Não Encontrado — 404 Not Found
```json
{
  "erro": "nao_encontrado",
  "mensagem": "Contrato não encontrado"
}
```

### Conflito de Estado — 409 Conflict
```json
{
  "erro": "estado_invalido",
  "mensagem": "Não é possível criar acordo em um contrato em rascunho",
  "status_atual": "rascunho"
}
```

### Erro Interno — 500 Internal Server Error
```json
{
  "erro": "erro_interno",
  "mensagem": "Erro ao processar a requisição",
  "referencia": "uuid-do-log"
}
```

---

## 6. Integrações com Asaas

Todas as operações abaixo são chamadas do sistema Azit Move para a API do Asaas. Usar sempre o client HTTP interno com retry automático e logging completo de request/response para auditoria.

---

### 6.1 Criação de Titular no Asaas

Executado na originação quando o titular não tem `asaas_customer_id`. O sistema busca primeiro pelo CPF antes de criar.

**GET** `https://api.asaas.com/v3/customers?cpfCnpj={cpf}`

Se não encontrado:

**POST** `https://api.asaas.com/v3/customers`

```json
{
  "name": "Samuel Antonio Gomes",
  "cpfCnpj": "10464432677",
  "mobilePhone": "27992370005",
  "email": "samufdg@gmail.com",
  "address": "Rua São Mateus",
  "addressNumber": "86",
  "complement": "Casa",
  "province": "Ataíde",
  "city": "Vila Velha",
  "state": "ES",
  "postalCode": "29119193",
  "externalReference": "titular_uuid"
}
```

**Response relevante:**
```json
{ "id": "cus_000167350365" }
```

> Salvar `id` retornado como `asaas_customer_id` no titular.

---

### 6.2 Criação de Cobrança

Uma cobrança avulsa por fatura, gerada no fechamento (D-5). **Nunca usar assinaturas recorrentes.**

**POST** `https://api.asaas.com/v3/payments`

**Cobrança padrão (sem split):**
```json
{
  "customer": "cus_000167350365",
  "billingType": "UNDEFINED",
  "value": 1047.00,
  "dueDate": "2026-04-29",
  "description": "Fatura #4 — Azit Move",
  "externalReference": "fatura_uuid",
  "fine": { "value": 2.00 },
  "interest": { "value": 1.00 },
  "postalService": false
}
```

**Cobrança com split (quando contrato tem investidor de ativo específico):**
```json
{
  "customer": "cus_000167350365",
  "billingType": "UNDEFINED",
  "value": 1047.00,
  "dueDate": "2026-04-29",
  "description": "Fatura #4 — Azit Move",
  "externalReference": "fatura_uuid",
  "fine": { "value": 2.00 },
  "interest": { "value": 1.00 },
  "postalService": false,
  "split": [
    {
      "walletId": "wallet_investidor_xyz",
      "fixedValue": 900.00
    },
    {
      "walletId": "wallet_azit",
      "fixedValue": 147.00
    }
  ]
}
```

> `billingType: UNDEFINED` — o titular comprador escolhe o meio (PIX, boleto, cartão).
> `externalReference` — chave de conciliação com a fatura no sistema Azit.
> `split.walletId` — ID da carteira Asaas do titular-investidor (vinculado ao `ContratoInvestimento` que financia o ativo). Esse titular precisa ter conta no Asaas.
> Os valores do split devem somar exatamente o `value` total da cobrança.
> O breakdown do split é calculado pelo sistema Azit antes de chamar o Asaas.

> ⚠️ **Placeholder:** A fórmula exata de cálculo do split (quanto vai para o investidor vs. Azit) depende da estrutura jurídica do fundo — a definir com Vicente/Sebastião.

**Response relevante:**
```json
{
  "id": "pay_abc123",
  "invoiceUrl": "https://asaas.com/i/abc123",
  "bankSlipUrl": null,
  "status": "PENDING"
}
```

> Salvar `id` retornado como `asaas_charge_id` na fatura.

---

### 6.3 Cancelamento de Cobrança

Necessário em situações como: acordo efetivado (cancela cobranças das faturas cobertas), erro de geração, estorno de contrato.

**DELETE** `https://api.asaas.com/v3/payments/{asaas_charge_id}`

**Response:** `200 OK` com `{ "deleted": true }`

**Quando executar:**
- Acordo efetivado → cancelar cobranças das faturas cobertas no Asaas
- Contrato cancelado → cancelar todas as cobranças pendentes
- Fatura corrigida antes do vencimento → cancelar e recriar com valor correto

> Após cancelar no Asaas, atualizar `asaas_charge_id` da fatura para `null` e registrar o motivo no histórico.

---

### 6.4 Estorno de Pagamento

Quando um pagamento já confirmado precisa ser revertido (ex: parcela Estornada).

**POST** `https://api.asaas.com/v3/payments/{asaas_charge_id}/refund`

```json
{
  "value": 1047.00,
  "description": "Estorno por erro de conciliação"
}
```

**Processamento pelo sistema após estorno:**
1. Webhook `PAYMENT_REFUNDED` recebido
2. Parcelas vinculadas: Paga → **Estornada**
3. Fatura: Paga → **Vencida** (volta ao estado anterior)
4. Contrato: reavaliado — se ficou com obrigações em aberto → Inadimplente

---

### 6.5 Consulta de Status da Cobrança

Usado para sincronização quando webhook não foi recebido ou para auditoria.

**GET** `https://api.asaas.com/v3/payments/{asaas_charge_id}`

**Response relevante:**
```json
{
  "id": "pay_abc123",
  "status": "RECEIVED",
  "value": 1047.00,
  "paymentDate": "2026-04-29",
  "clientPaymentDate": "2026-04-29",
  "netValue": 1025.00,
  "originalValue": 997.00,
  "interestValue": 0,
  "fineValue": 0,
  "externalReference": "fatura_uuid"
}
```

> Deve ser usado em job de reconciliação periódica para detectar pagamentos cujo webhook falhou.

---

### 6.6 Split de Pagamento — Regras de Negócio

O split é configurado no momento da criação da cobrança, não no momento do pagamento. As regras são:

**Contrato de crédito com capital próprio ou empréstimo:**
Sem split. Todo o valor vai para a carteira Azit.

**Contrato de crédito com investidor de ativo específico:**
Split entre carteira do titular-investidor e carteira Azit:
- Valor do investidor = amortização de capital + rendimento (fórmula a definir — placeholder)
- Valor da Azit = taxa de serviço + itens recorrentes (proteção, rastreador)

**Contrato de crédito com fundo:**
Split entre carteira do fundo e carteira Azit:
- Valor do fundo = parcela de principal (amortização + rendimento)
- Valor da Azit = taxa de serviço + itens recorrentes
- O fundo faz repasse mensal aos investidores PF — processado fora do sistema de cobrança

**Tratamento de encargos por atraso no split:**
- Atraso ≤ 30 dias: encargos (multa + juros) ficam integralmente com a Azit
- Atraso > 30 dias: regra de compartilhamento com investidor a definir — placeholder

---

### 6.7 Webhooks do Asaas — Mapa Completo

| Evento | Situação | Ação no sistema |
|---|---|---|
| `PAYMENT_RECEIVED` | Pagamento confirmado | Concilia fatura, baixa parcelas, calcula breakdown |
| `PAYMENT_OVERDUE` | Pagamento em atraso | Fatura → Vencida, contrato → Inadimplente, ativa régua |
| `PAYMENT_REFUNDED` | Pagamento estornado | Parcelas → Estornadas, fatura → Vencida |
| `PAYMENT_DELETED` | Cobrança deletada externamente | Log + alerta para revisão manual |
| `PAYMENT_RESTORED` | Cobrança restaurada | Log + revisão manual |
| `PAYMENT_UPDATED` | Cobrança atualizada externamente | Log + conferência com dados internos |

> Todos os webhooks devem ser idempotentes — processar o mesmo evento duas vezes não deve gerar efeito duplicado. Usar `asaas_charge_id` + `event` como chave de idempotência.

---

## 6-B. Controle de frota — doc 02 §25 (20/09)

A **lista da frota** é a tela de ativos: `GET /ativos` passou a devolver `cliente`
(titular do contrato ATIVO, com id e número do contrato) e `observacao`. A anotação livre é
gravada pelo endpoint que já existia: `PATCH /ativos/:id` com `{ "observacao": "..." }`
(`null` ou vazio limpa). Não há tela nem rota de "situação do veículo": o status é automático.

Ocorrências (multa, IPVA, licenciamento…) — papéis ADMIN, DIRETOR e OPERADOR:

| Método e rota | O que faz |
|---|---|
| `GET /frota/opcoes` | Rótulos de tipo e de situação, para filtros e colunas |
| `GET /frota/ocorrencias` | Filtros: `status` (ou `abertas`), `tipo`, `responsavel`, `ativoId`, `busca` (placa ou número do auto) |
| `POST /frota/ocorrencias` | Registro manual; identifica o veículo por `ativoId` ou `placa`. O responsável sai da **data do fato** contra a posse do cliente |
| `POST /frota/ocorrencias/:id/reabrir` | `{ motivo? }` — volta para REGISTRADA. Recusa a REPASSADA (já é item de fatura). Se a Azit tinha assumido, **desfaz o custo** lançado no veículo (doc 02 §25.7) |
| `POST /frota/ocorrencias/:id/responsavel` | `{ responsavel, justificativa }` — sobrepõe o cálculo (mínimo 10 caracteres, auditado) |
| `POST /frota/ocorrencias/:id/repassar` | `{ valor? }` — item SERVICO na próxima fatura ABERTA da conta, somando no total (422 `sem_fatura_aberta` quando não há ciclo à frente) |
| `POST /frota/ocorrencias/:id/cliente-paga` | `{ prazoComprovante?, observacao? }` — pendência de comprovante (padrão 7 dias) |
| `POST /frota/ocorrencias/:id/comprovante` | `{ arquivo?: { nome, conteudo base64 }, observacao? }` → quitada |
| `GET /frota/ocorrencias/:id/comprovante` | Baixa o comprovante |
| `POST /frota/ocorrencias/:id/assumir` | Vira `LancamentoCustoAtivo` (centro de custo do veículo) |
| `POST /frota/ocorrencias/:id/recurso` · `/cancelar` | Demais desfechos |
| `POST /frota/ocorrencias/importar-infleet` | `{ usuario, senha }` — robô com navegador no servidor. A credencial **não** é gravada nem enfileirada; roda na própria requisição. Devolve `criadas`, `atualizadas`, `ignoradas`, `naoMapeadas` e `amostraBruta` |

Idempotência: a chave é o **número do auto**. Reimportar atualiza os dados da fonte e nunca
sobrescreve desfecho ou responsável definidos pelo operador.

Agendado: alerta diário às 7h (America/Sao_Paulo) de prazo de indicação, comprovante atrasado
e vencimento próximo.

## 6-C. Migração do legado — doc 02 §26 (21/09)

Bancada de conciliação dos clientes que já existem no Asaas. **F1**: leitura + triagem + tela.
Nada aqui cria titular ou contrato (F3). Papéis: ADMIN, DIRETOR, OPERADOR, FINANCEIRO.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/migracao-legado/resumo` | Ambiente da fonte (`simulado`/`sandbox`/`producao`), última coleta (andamento, contagens, erro), casos por status e por situação, opções dos filtros |
| POST | `/migracao-legado/coletar` | Dispara a leitura do Asaas em segundo plano (fila `coleta-legado`). **202**. 409 `coleta_em_andamento` se já houver uma rodando |
| GET | `/migracao-legado/casos?status=&situacao=&busca=` | Casos ordenados pela triagem: `prioridade` asc (1 = em dia), depois menos vencidas, mais pagas |
| GET | `/migracao-legado/casos/:id` | Caso completo: cliente, assinatura, proposta de decomposição da parcela (§26.2) e todas as cobranças com `classe` (`paga`/`pendente`/`vencida`/`outra`) | O detalhe traz `conciliacao.modo`, `conciliacao.acordos[]` (grupos com `proposta` e `confirmado`), `modoConciliacao`, linhas com `confianca`, `deslocamentoDias`, `acordoGrupo`, `componentes.acordo`, situações `paga_por_acordo`/`em_acordo`; desfecho novo `ADIADA` (§26.14).
| PATCH | `/migracao-legado/casos/:id/status` | `{ status, observacao? }`. Transições da F1: COLETADO→EM_REVISAO/DESCARTADO, EM_REVISAO→COLETADO/DESCARTADO, DESCARTADO→COLETADO. 422 `transicao_invalida`; descartar exige `observacao` (422 `motivo_obrigatorio`) |
| PATCH | `/migracao-legado/casos/:id/observacao` | `{ observacao }` — anotações do caso (o que achou no PopHub) |

**Leitura do Asaas** (`AsaasLeituraService`): `GET /customers`, `GET /subscriptions?customer=`,
`GET /payments?customer=`, todas paginadas (`limit=100&offset=`). Ritmo de ~4 chamadas/s e, ao
receber 429/403 "limite de requisições", espera 30s → 60s → 120s e repete (visto no sandbox em
21/09: ~230 chamadas em um minuto bloqueiam). Reler é idempotente: atualiza triagem e cobranças,
preserva status e observação dados pelo operador.

**Situação** (triagem pura em `@azit/utils/migracao-legado`): `SEM_VENCIDA` (assinatura ativa ou
cobrança em aberto, nenhuma vencida — prioridade 1), `COM_VENCIDA` (2), `SEM_MOVIMENTO` (sem
assinatura ativa nem cobrança em aberto — 3, sugestão de descarte). A data decide vencida/pendente,
não o status do Asaas.

**F2 — termos, PDF, leitura das cobranças, conciliação e validação (doc 02 §26.7, 22/09):**

| Método | Rota | O que faz |
|---|---|---|
| PUT | `/migracao-legado/casos/:id/termos` | Grava os termos do contrato (`TermosContratoLegado`, valores em centavos). 422 `termos_invalidos` com `campos`. Reaplica a leitura por regra nas cobranças não decididas pelo operador |
| POST | `/migracao-legado/casos/:id/pdf` | `{ nome, conteudo }` (base64). Guarda em `uploads/legado`, lê o texto (pdf-parse) e, se for o modelo Mod06, **pré-preenche** os termos vazios. Devolve `modeloReconhecido`, `extraidos`, `faltantes`, `cpfDiverge` (CPF do contrato ≠ CPF do cliente no Asaas — **trava a validação**, doc 02 §26.13) |
| POST | `/migracao-legado/casos/:id/contrato/mover` | `{ destinoId }` — leva PDF + termos ao caso cujo cliente no Asaas tem exatamente o CPF do contrato; a origem fica sem contrato, reconhecimentos e vínculos. 422 `cpf_nao_confere` / `destino_com_contrato` / `caso_fechado` / `sem_contrato`. O detalhe do caso traz `contratoDeOutroCliente: { cpfContrato, nomeContrato, casos[] } \| null` |
| DELETE | `/migracao-legado/casos/:id/contrato` | Retira PDF + termos do caso (as cobranças ficam) |
| GET | `/migracao-legado/casos/:id/pdf` | O PDF anexado (`application/pdf`, inline) |
| POST | `/migracao-legado/casos/:id/interpretar` | Reaplica as regras de leitura nas cobranças que o operador não decidiu |
| PUT | `/migracao-legado/casos/:id/cobrancas/:cobrancaId/interpretacao` | Decisão do operador: `{ tipo, parcelamento?, seguro?, taxa?, intermediaria?, observacao? }`. A decomposição precisa somar o valor original (422 `decomposicao_nao_fecha`). Fica `interpretadoPor: operador` e nenhuma releitura sobrescreve |
| DELETE | `…/cobrancas/:cobrancaId/interpretacao` | Desfaz a decisão e volta à regra |
| PUT | `/migracao-legado/casos/:id/divergencias/:chave` | `{ nota, desfecho }` — reconhece uma divergência da conciliação (`parcela:N`, `intermediaria:N`, `entrada`, `cobranca:<id>`). `desfecho` (doc 02 §26.9 item 6) é o que a F3 gera: `PAGA_FORA_ASAAS` \| `VALOR_ACEITO` para linhas do cronograma, `COBRANCA_AVULSA` para `cobranca:<id>`. 422 `nota_obrigatoria` / `desfecho_obrigatorio` |
| PUT | `/migracao-legado/casos/:id/vencimentos` | `{ modo: 'CONTRATO' \| 'ASAAS' }` — vencimentos na migração, escolha por caso (doc 02 §26.9 item 4). 422 `modo_invalido` |
| PUT | `/migracao-legado/casos/:id/conciliacao-modo` | `{ modo: 'SEQUENCIA' \| 'DATA' }` — como a parcela N é encontrada (doc 02 §26.14). 422 `modo_invalido` |
| PUT | `/migracao-legado/casos/:id/acordos/:grupo` | `{ quantidade?, chaves? }` — confirma o que o acordo legado quitou (sem corpo vale a proposta; `chaves` só no modo DATA). 422 `parcelas_insuficientes` / `parcela_ja_paga` |
| DELETE | `/migracao-legado/casos/:id/acordos/:grupo` | Desfaz a confirmação |
| PUT | `/migracao-legado/casos/:id/conciliacao-declarada` | `DeclaracaoConciliacao` (doc 02 §26.15) — grava o cronograma validado caso a caso; substitui as regras. ADMIN/DIRETOR. 422 `declaracao_invalida` / `cobranca_desconhecida`. O detalhe traz `conciliacaoDeclarada { em, por, origem, observacao, parcelas }` e `conciliacao.modo = 'DECLARADA'` |
| DELETE | `/migracao-legado/casos/:id/conciliacao-declarada` | Remove a declaração (o caso volta às regras) |
| POST | `/migracao-legado/casos/:id/recomecar-conciliacao` | Limpa leituras manuais, vínculos, reconhecimentos e acordos confirmados; reaplica as regras. Devolve as contagens limpas |
| PUT | `/migracao-legado/casos/:id/cobrancas/:cobrancaId/interpretacao` | Aceita também `acordo` (parcela de acordo junto da cobrança) |
| GET | `/migracao-legado/casos/:id/migracao/previa` | ADMIN/DIRETOR. Plano da F3 (doc 02 §26.10) sem gravar nada: titular (novo/existente), veículo, contrato, entrada, faturas por situação, RPs, avulsas, assinatura a parar. 422 `nao_validado` / `ja_migrado` / `pendencias` / `cpf_ausente` / `estrutura_azit_ausente` / `titular_excluido` / `veiculo_em_contrato` |
| POST | `/migracao-legado/casos/:id/migrar` | ADMIN/DIRETOR. Executa o plano numa transação (caso → MIGRADO, `titularId`/`contratoId` preenchidos) e DEPOIS para a assinatura no Asaas (PUT INACTIVE), apaga as cobranças A VENCER da assinatura antiga e emite na hora as do D-5 (doc 02 §26.5 item 2). Retorna `{ titularId, contaId, contratoId, contratoNumero, resumo, assinatura: { parada, motivo }, substituicao: { apagadas, emitidasAgora, mantidas[] } }` — `parada:false` = contrato criado, assinatura ainda ativa (repetir abaixo) |
| POST | `/migracao-legado/casos/:id/completar` | ADMIN/DIRETOR. Caso MIGRADO: grava a taxa de desconto vigente no contrato e a FIPE oficial no veículo, só onde está vazio (doc 02 §26.11). Retorna `{ taxa, taxaGravada, fipe, fipeGravada, fipeMotivo }` |
| POST | `/migracao-legado/casos/:id/limpar-cobrancas-orfas` | ADMIN/DIRETOR. Caso MIGRADO: apaga no Asaas cobranças pendentes a vencer sem `externalReference` (emitidas pela assinatura depois da coleta). Retorna `{ apagadas, erro, vencimentos }` |
| POST | `/migracao-legado/casos/:id/parar-assinatura` | ADMIN/DIRETOR. Repete o PUT INACTIVE de um caso MIGRADO cuja assinatura não foi parada |
| DELETE | `/migracao-legado/casos/:id/divergencias/:chave` | Desfaz o reconhecimento |
| PUT | `/migracao-legado/casos/:id/vinculos/:cobrancaId` | `{ chave }` — vínculo MANUAL: a cobrança passa a compor a linha `parcela:N` / `intermediaria:N` / `entrada` (sem divergência; a observação avisa se a soma difere). 422 `cobranca_invalida` / `linha_invalida` |
| DELETE | `/migracao-legado/casos/:id/vinculos/:cobrancaId` | Desfaz o vínculo manual |
| POST | `/migracao-legado/casos/:id/validar` | EM_REVISAO → VALIDADO. 422 `pendencias` com a lista: termos incompletos, PDF ausente, cobrança em dúvida ou sem leitura, divergência sem reconhecimento. VALIDADO → EM_REVISAO é pelo `PATCH …/status` (reabrir) |

O `GET /migracao-legado/casos/:id` passa a devolver `termos`, `termosFaltantes`, `pdf`, `extracaoPdf`,
as cobranças com `valorOriginal`, `encargoPago` (juros/multa: `originalValue`/`interestValue` do
Asaas), `tipoInterpretado`, `interpretacao`, `duvida`, `interpretadoPor`; a `conciliacao` (linhas do
cronograma esperado × cobranças, `fora` do cronograma, `resumo`), `divergenciasReconhecidas`,
`pendenciasParaValidar` e `tiposCobranca`. Tipos de cobrança: parcela · intermediaria (entrada diluída) ·
entrada · acordo · reembolso (IPVA, multa, manutenção…) · outra. Motores puros em `@azit/utils`:
`legado-termos` (extração do Mod06), `legado-interpretacao`, `legado-conciliacao` (±3 dias, valor exato).

## 6-D. Contas a pagar — plano de categorias (doc 02 §18.6, 05/10)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/financeiro/configuracao` | Passa a trazer `grupos[]` e cada natureza com `grupoId` e `saida` |
| POST | `/financeiro/grupos` | `{ codigo, nome, ordem? }` (ADMIN/DIRETOR). 422 `codigo_duplicado` |
| PATCH | `/financeiro/grupos/:id` | `{ nome?, ordem?, ativo? }` |
| POST | `/financeiro/naturezas` | Agora exige `grupoId`; aceita `saida` (false = receita, não entra em título). 422 `codigo_duplicado` |
| PATCH | `/financeiro/naturezas/:id` | `{ nome?, grupoId?, saida?, exigeAtivo?, exigeCotacao?, especial?, exigeJustificativa?, ativo? }` — o código não muda |
| POST | `/financeiro/titulos` | `centroCustoAreaId` passa a ser opcional. 422 `natureza_inativa` / `natureza_de_entrada` |
| POST | `/financeiro/orcamentos/:id/converter` | `centroCustoAreaId` opcional |
| GET | `/financeiro/por-categoria?mes=YYYY-MM` | Quadro do mês pelo vencimento: `{ mes, total, grupos[{…, categorias[{ codigo, nome, saida, ativo, aberto, pago, cancelado, quantidade }]}], semGrupo[] }` (centavos) |

O título lista `natureza.grupo { codigo, nome }` e `centro` pode ser `null`.

## 7. Placeholders de API

| Endpoint | Descrição | Bloqueio |
|---|---|---|
| `POST /api/v1/itens-contratados` | Aceite rápido para novos produtos/crédito avulso | Fluxo de aceite a definir |
| `GET /api/v1/titulares/:id/portfolio-investimento` | Visão de performance dos contratos de investimento do titular (ativo específico) | Fórmula de breakdown a definir |
| `GET /api/v1/fundos/:id/performance` | Visão consolidada do fundo | Estrutura jurídica a definir |
| `POST /api/v1/alçadas/:tipo/solicitar` | Submete operação para aprovação em alçada | Regras de alçada a definir |
| `POST /api/v1/alçadas/:id/aprovar` | Aprova uma solicitação em alçada | Regras de alçada a definir |
| `GET /api/v1/recebíveis/breakdown` | Relatório de breakdown de recebíveis por contrato/período | Fórmula a definir |

---

*Documento vivo — atualizar a cada nova integração ou endpoint implementado.*
*Versão 1.0 — 2026-06-23*

### 4.8-A Visão da carteira por período (doc 02 §27, 30/10/2026)

Todas as rotas abaixo usam a MESMA agregação (`agregarVisaoCarteira`, @azit/utils). `teto`/`pagas`/
`vencidas`/`aVencer` são por VENCIMENTO; `recebido` é CAIXA (data de pagamento: faturas de qualquer
vencimento + entradas de contrato/acordo). `porProduto` só tem PRODUTO como linha (31/10): acordo,
entradas, intermediárias e avulsos somam dentro do produto e aparecem em `composicao[]`. Datas são
data-calendário no fuso do negócio.

`GET /api/v1/contas/carteira/visao?de=2026-10-01&ate=2026-10-31`

```json
{
  "periodo": { "de": "2026-10-01", "ate": "2026-10-31" },
  "hoje": "2026-10-29",
  "teto":      { "valor": 24585433, "faturas": 235, "clientes": 61 },
  "pagas":     { "valor": 16585231, "faturas": 166, "clientes": 55, "valorPago": 16693479 },
  "vencidas":  { "valor": 6572729,  "faturas": 56,  "clientes": 29 },
  "aVencer":   { "valor": 1427473,  "faturas": 13,  "clientes": 13 },
  "recebido":  { "valor": 21266267, "recebimentos": 198, "clientes": 59, "faturasDoPeriodo": 16693479, "faturasDeOutrosPeriodos": 3774788, "entradas": 798000, "encargos": 108248 },
  "porProduto": [
    { "chave": "compra_parcelada", "rotulo": "Compra Parcelada", "teto": 21583496, "pagoDoPeriodo": 14928673, "recebido": 19099122,
      "composicao": [
        { "parte": "parcela", "rotulo": "Parcelas", "teto": 20224496, "pagoDoPeriodo": 14239773, "recebido": 17612222 },
        { "parte": "acordo", "rotulo": "Acordo / renegociação", "teto": 1359000, "pagoDoPeriodo": 688900, "recebido": 688900 },
        { "parte": "entrada_contrato", "rotulo": "Entradas de contrato", "teto": 0, "pagoDoPeriodo": 0, "recebido": 798000 }
      ] },
    { "chave": "protecao_veicular", "rotulo": "Proteção veicular", "teto": 1194804, "pagoDoPeriodo": 832078, "recebido": 1020400, "composicao": [{ "parte": "parcela", "rotulo": "Parcelas", "teto": 1194804, "pagoDoPeriodo": 832078, "recebido": 1020400 }] }
  ],
  "encargosRecebidos": 108248
}
```

`GET /api/v1/contas/carteira/visao/mensal?de=2025-07&ate=2026-12` → `[{ "mes": "2026-10", …mesmo corpo… }]`
(meses sem fatura não vêm).

`GET /api/v1/contas/carteira/visao` traz também `"ativos": { "clientes": 66, "semFatura": [{ "contaId",
"titularId", "titular", "proximaFatura": "2026-12-05" }] }` — clientes ativos (conta com contrato ATIVO) e
quem deles não tem fatura contável no período (doc 02 §27.10).

`GET /api/v1/contas/carteira/visao/limites` → `{ "primeiroMes": "2025-08", "ultimoMes": "2030-11" }` — mês da primeira
e da última fatura que conta para o teto (doc 02 §27.11); limita o gráfico "Mês a mês" e as setas do
período. `GET /api/v1/contas/carteira/visao/mensal` aceita qualquer intervalo entre os dois.

`GET /api/v1/contas/carteira/visao/variacao?de=2026-12&para=2027-01` → por que o teto muda de um mês
para o outro (doc 02 §27.10): `{ "de", "para", "tetoDe", "tetoPara", "diferenca", "grupos": [{ "motivo":
"calendario|entrou|saiu|faturas|valor", "sentido": "mais|menos", "valor", "faturas", "clientes", "contas":
[{ "contaId", "titularId", "titular", "valor", "faturas" }] }] }`. Centavos com sinal; a soma de
`grupos[].valor` é `diferenca`.

`GET /api/v1/contas/carteira/visao/clientes?de&ate&estado=recebidas|vencidas|a_vencer` →
`[{ "contaId", "titularId", "titular", "valor", "faturas", "maisAntiga": "2026-10-13", "ultimoPagamento?": "2026-10-27", "bloqueada": false }]`
(vencidas por valor desc; demais por nome). `recebidas` lista quem PAGOU no período (caixa): `valor` =
o que entrou, `faturas` = recebimentos (faturas + entradas), `maisAntiga` = primeiro pagamento,
`ultimoPagamento` = último.

### 4.2-A Conferência Asaas × sistema (doc 02 §27.9, 12/11/2026)

Faturas ABERTA/FECHADA com `asaasChargeId` e vencimento em `[de, ate]`, lidas uma a uma no Asaas.
Sem `de`: desde o início; sem `ate`: até ontem (fuso Brasil) — tudo que está vencido. Só leitura;
nada é alterado no Asaas. ADMIN/OPERADOR. Lotes pequenos + cache de 60 s por cobrança.

`GET /api/v1/cobranca/conferencia-asaas?de=2026-11-01&ate=2026-11-11`

```json
{
  "periodo": { "de": "2026-11-01", "ate": "2026-11-11" },
  "hoje": "2026-11-12",
  "consultadoEm": "2026-11-12T12:40:03.120Z",
  "ambiente": "producao",
  "total": 42,
  "porClassificacao": { "paga_no_asaas": 5, "removida_no_asaas": 2, "estornada_no_asaas": 0, "vencimento_diferente": 0, "valor_diferente": 0, "ok": 35 },
  "falhas": [],
  "linhas": [
    {
      "faturaId": "fat_…", "numero": 7, "contaId": "conta_…", "titularId": "tit_…", "titular": "Antônio Silva",
      "statusAqui": "FECHADA", "situacaoAqui": "vencida", "vencimentoAqui": "2026-11-05", "valorAqui": 99700,
      "asaasChargeId": "pay_…",
      "asaas": { "id": "pay_…", "status": "RECEIVED", "vencimento": "2026-11-05", "valor": 99700, "valorOriginal": null, "dataPagamento": "2026-11-06", "deleted": false, "invoiceUrl": "https://www.asaas.com/i/…" },
      "classificacao": "paga_no_asaas"
    }
  ]
}
```

`asaas: null` = o Asaas respondeu 404 (→ `removida_no_asaas`). `falhas[]` = cobranças que não deu
para ler (rede/5xx) — ficam fora de `linhas` e de `total`. Valores em centavos; datas calendário.

`POST /api/v1/cobranca/conferencia-asaas/:faturaId/reconciliar` → **202**

Só para `paga_no_asaas` (relê a cobrança ao vivo). Enfileira o MESMO job `conciliar` da fila
`pagamento-recebido` que o webhook geraria:

```json
{ "enfileirado": true, "statusAsaas": "RECEIVED", "job": { "faturaId": "fat_…", "paymentDate": "2026-11-06", "dueDate": "2026-11-05", "valor": 99700 } }
```

Erros 422: `fatura_nao_aberta`, `sem_cobranca`, `asaas_simulado`, `nao_paga_no_asaas`
(com `classificacao` e `statusAsaas`). 404: `nao_encontrado`.

### 4.2-B Conferência automática diária (doc 02 §27.9.1, 18/11/2026)

Todo dia às 3h30 (fuso Brasil, confirmado em 20/11/2026) o agendamento só enfileira a rodada na fila
`conferencia-asaas` (jobId `conferencia-asaas-AAAA-MM-DD`). O worker lê no Asaas toda fatura
ABERTA/FECHADA com `asaasChargeId` e `modeloEncargo = ASAAS_NATIVO`, **sem limite de vencimento**
(vencidas, que vencem hoje e a vencer), e para cada `paga_no_asaas` chama o Reconciliar do §4.2-A
(jobId do `conciliar`: `conferencia-auto-AAAA-MM-DD-<faturaId>`). Exceção: paga no Asaas com o
mesmo valor já imputado aqui como parcial → `pago_a_menor_ja_registrado`, fica para o operador.
Cada rodada é gravada em `logs_auditoria` (`acao = conferencia_asaas_automatica`,
`entidade = conferencia_asaas`, `entidadeId` = dia). ADMIN/OPERADOR nas duas rotas.

`GET /api/v1/cobranca/conferencia-asaas/automatica`

```json
{
  "horario": "3h30",
  "ultima": {
    "dia": "2026-11-19", "origem": "agendada", "disparadaPor": null,
    "iniciadaEm": "2026-11-19T06:30:00.412Z", "concluidaEm": "2026-11-19T06:30:41.090Z", "ambiente": "producao",
    "lidas": { "total": 58, "vencidas": 31, "venceHoje": 0, "aVencer": 27 },
    "baixadas": [
      { "faturaId": "fat_…", "numero": 49, "titularId": "tit_…", "titular": "…", "vencimento": "2026-11-18", "situacao": "vencida",
        "valorAqui": 74900, "asaasChargeId": "pay_…", "statusAsaas": "RECEIVED", "valorAsaas": 74900, "dataPagamentoAsaas": "2026-11-18",
        "classificacao": "paga_no_asaas", "pagoEm": "2026-11-18", "valorPago": 74900, "situacaoAgora": "baixada" }
    ],
    "naoBaixadas": [],
    "divergencias": [ { "faturaId": "fat_…", "numero": 12, "classificacao": "removida_no_asaas", "statusAsaas": null, "…": "…" } ],
    "divergenciasNovas": 1,
    "semLeitura": []
  },
  "anteriores": [ { "dia": "2026-11-18", "origem": "manual", "concluidaEm": "…", "lidas": 60, "baixadas": 2, "divergencias": 1, "semLeitura": 0 } ]
}
```

`situacaoAgora` (só na última rodada) é lida na hora: `baixada` (fatura PAGA/PAGA_EM_ATRASO) ou
`aguardando_conciliacao`. `naoBaixadas[]` = pagas no Asaas cuja baixa não foi enfileirada, com
`motivo` (Asaas simulado, ou mudou entre a leitura e a releitura ao vivo). `ultima: null` = ainda
não rodou. Valores em centavos; datas calendário.

`POST /api/v1/cobranca/conferencia-asaas/automatica/rodar` → **202**
`{ "enfileirado": true, "jobId": "conferencia-asaas-2026-11-19-manual-1763…" }` — a MESMA rodada,
fora do horário ("Rodar agora" na tela). Rodar duas vezes no dia não baixa nada em dobro.

Valores em centavos. 400 `validacao` para datas fora de `YYYY-MM-DD`/`YYYY-MM` ou `de > ate`.

`GET /api/v1/contas/carteira/resumo` (doc 02 §27.8) →
`{ "contas": 62, "contasEmAtraso": 29, "contasBloqueadas": 2, "contratosAtivos": 66, "valorSobGestaoPresente": 0, "valorSobGestaoNominal": 0, "valorEmAtraso": 0 }`
— valor sob gestão a valor presente = soma de `QuitacaoService.simular(contrato).valorQuitacao` dos contratos ATIVO.

## 6-E. Lista de espera e veículo de referência — doc 02 §31 (03/11/2026)

**FIPE em tela** (só leitura, fonte oficial; valor nunca digitado):
- `GET /fipe/marcas` → `[{ codigo, nome }]`
- `GET /fipe/modelos?marca=` → `[{ codigo, nome }]`
- `GET /fipe/anos?marca=&modelo=` → `[{ codigo: "2020-1", nome: "2020 Gasolina" }]`
- `GET /fipe/valor?marca=&modelo=&ano=` → `{ valor (centavos), codigoFipe, marca, modelo, anoModelo, combustivel, referencia }`

**Simulação por referência**: `POST /simulacoes` aceita `referencia: { codigoMarca, codigoModelo, ano }`
no lugar de `ativoId`/`valorAvista`; o detalhe devolve `referencia` (`VeiculoReferencia` com `rotulo`).
`POST /propostas` converte simulação com referência (proposta nasce com `referenciaId` e `ativoId` nulo).
Detalhe da proposta: `ativo` pode ser nulo; `referencia`, `veiculo` (rótulo único), `veiculoAtribuidoEm`,
`veiculoConferidoEm`.

**Lista de espera**:
- `GET /propostas/lista-espera` → aprovadas por referência sem contrato, mais antiga primeiro:
  `{ id, titular, referencia, ativo, valorEntrada, valorParcela, numeroParcelas, frequencia, foraParametro,
  analiseId, aprovadaEm, validaAte (+60 dias), diasRestantes, situacao: na_fila | em_conferencia | pronta |
  expirada, ajuste }`.
- `POST /propostas/:id/atribuir-veiculo { ativoId }` (ADMIN/OPERADOR): reserva o ativo (`RESERVADO`),
  recalcula a condição com o carro real e guarda em `conferenciaVeiculo` (não sobrescreve a proposta);
  aprovação vencida refaz a Camada 1; avisa a área Análise. 422: `ativo_indisponivel`, `ativo_sem_valor`,
  `ja_atribuido`, `camada1_reprovada`.
- `POST /propostas/:id/conferir-veiculo { confirmar, observacao? }`: `true` aplica o ajuste (parcela,
  adicional de proteção, nº de parcelas, fora de parâmetro) e carimba `veiculoConferidoEm`; `false` solta o
  ativo e devolve a proposta à fila.
- `POST /propostas/:id/formalizar` passa a exigir ativo e, se por referência, conferência (`sem_veiculo`,
  `veiculo_nao_conferido`).

**Ativos**: status `reservado` nos filtros/atualização; `AtivoApi.reserva = { propostaId, titularNome, em } | null`.

**Dossiê da análise** (`GET /analises/:id`): `veiculo` (tipo `ativo` com km/origem/contratos anteriores/
FIPE × venda, ou `referencia`) e `conferenciaVeiculo` (parcela aprovada × ajuste, pendente ou não).

## 6-F. Fatura Azit — página pública, Pix sob demanda e Configurações › Faturamento — doc 02 §32 (11–15/11/2026)

Valores em **centavos**; datas-calendário em `YYYY-MM-DD` (dia do Brasil).

### Rotas públicas (sem login; acesso pelo token de 64 hex da fatura)

Limite em memória por IP e por token (`LimitePublicoGuard`): 90/min por IP, 60/min por token,
10 PDFs/min por IP e **12 pedidos de Pix/min por token**. Estouro → 429 `muitas_requisicoes`.
Token inexistente, malformado ou de fatura extinta → 404 `fatura_indisponivel`, com
`atendimentoWhatsapp` e `atendimentoWhatsappLink` (o WhatsApp da Azit; nada da conta).

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/v1/publico/faturas/:token` | Projeção da fatura (`FaturaPublica`, `@azit/types`). Fatura do modelo **AZIT** traz `conta` |
| GET | `/api/v1/publico/faturas/:token/situacao` | Polling (~30 s). No modelo AZIT inclui `assinatura`: muda quando entra pagamento na conta ou o dia vira (gerar um Pix não muda) |
| POST | `/api/v1/publico/faturas/:token/intencao` | **Pix sob demanda** (só modelo AZIT). Body `{ "valor": 107243 }` |
| GET | `/api/v1/publico/faturas/:token/pdf` | PDF: fatura (em aberto) ou comprovante (paga). `?fatura=<nº>` imprime outra fatura da mesma conta que a página mostra |

**`FaturaPublica.conta` (modelo AZIT)** — `ContaFaturaPublica`: `hoje`, `faturaDoLink`, `faturas[]`
(id, número, vencimento, nome dos itens, Pix recebidos com data, hora e identificador),
`motor { faturas[], parametros }` (entrada do motor de `@azit/utils`: itens com grupo da cascata e
percentuais, pagamentos com alocações; a página refaz a conta com a mesma função do servidor),
`mista`, `antigasEmAberto[]`, `pix` (o Pix ativo mais recente de hoje, se houver), `pixAtivos[]`
(todos os ativos de hoje, um por valor), `recebedor`,
`atendimentoWhatsappLink`, `proximoVencimento`, `assinatura`. Nenhum dado pessoal além de primeiro
nome, placa e documento mascarado; nenhum token de outra fatura.

**`POST …/intencao`** — resposta 200 (`PixSobDemandaPublico`):

```json
{
  "valor": 1023500,
  "copiaECola": "000201…",
  "qrCodeImagem": null,
  "validoAte": "2026-11-16T02:59:59.999Z",
  "simulado": false,
  "outroValor": false,
  "faturas": [
    { "numero": 1, "vencimento": "2026-11-01", "valor": 512333 },
    { "numero": 2, "vencimento": "2026-11-08", "valor": 511167 }
  ]
}
```

Pedir de novo o mesmo valor no mesmo dia devolve o **mesmo** Pix. Outro valor cria **outro** Pix
e **não cancela** os anteriores (doc 02 §32.4-A, regra de 15/11): a conta pode ter vários ativos
no dia, um por valor. Os demais só são cancelados quando um pagamento é baixado na conta (fila
`intencao-pagamento`, job `cancelar`) ou na virada do dia. A página chama esta rota **ao
carregar** e a cada opção nova (pré-geração, doc 02 §32.12 item 4). Chamadas ao gateway têm tempo limite de 8 s; a duração da rota e de cada chamada
(`criarPix`, `POST /payments`, `GET pixQrCode`) sai no log do backend.

| Status | `erro` | Quando |
|---|---|---|
| 400 | `validacao` | `valor` ausente, não inteiro ou ≤ 0 |
| 422 | `valor_invalido` | fora da regra do dia; `motivo`: `abaixo_do_minimo`, `acima_do_total`, `sem_parcial`, `nada_em_aberto`; `mensagem` pronta para o cliente |
| 422 | `modelo_antigo` | fatura `ASAAS_NATIVO` (paga pela cobrança que já tem) |
| 429 | `limite_pix_dia` | teto de valores distintos por conta no dia (padrão 10) |
| 503 | `pix_indisponivel` | o gateway não respondeu; nada é gravado e o Pix anterior continua valendo |

### Webhook do gateway — referência `intencao:<id>`

Entra por `POST /api/v1/webhooks/asaas` (§3), mesma autenticação. `externalReference` começando
por `intencao:` é lido pelo `GatewayPix`; em `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` responde
**202** e enfileira `baixar` na fila `intencao-pagamento` (jobId pelo id do pagamento). Outros
eventos dessa referência são só ACK. Campos lidos de `payment`: `id`, `value`,
`clientPaymentDate` → `paymentDate` → `confirmedDate`, `pixTransaction`. A baixa é pela conta
(doc 02 §32.4-A), idempotente pelo id do pagamento.

### Webhook do gateway — pagamento de QR estático (modo `ESTATICO`, padrão desde 15/11)

O Pix sob demanda é lido **antes** dos demais fluxos. No modo ESTATICO o Asaas cria, ao receber,
uma cobrança já recebida com `payment.pixQrCodeId` (= `gatewayId` da intenção) e, em geral, sem
`externalReference`. Sempre **202**:

| Aviso (`PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`) | O que acontece |
|---|---|
| `externalReference = intencao:<id>` | enfileira `baixar` (como acima) |
| `pixQrCodeId` presente | enfileira `identificar` na fila `intencao-pagamento` (jobId pelo id do pagamento); o worker acha a intenção por `gatewayId` e enfileira `baixar` |
| Pix sem referência e sem `pixQrCodeId`, que não é cobrança amarrada a fatura (`asaasChargeId`) | enfileira `identificar` sem id; o worker lê `GET /payments/{id}` no Asaas para obter o `pixQrCodeId` |
| qualquer outro evento com `pixQrCodeId` | só ACK |

Resultados do job `identificar`: `baixa_enfileirada`, `pix_desconhecido` (não é intenção deste
ambiente) e `sem_pix_de_origem` (o pagamento não veio de QR) — os dois últimos sem efeito.
Campos novos lidos de `payment`: `pixQrCodeId`, `billingType`. `payment.customer` não é lido.

Chamadas ao Asaas no modo ESTATICO: `GET /pix/addressKeys?status=ACTIVE` (chave que recebe, em
memória), `POST /pix/qrCodes/static` (criar; limite de tempo `ASAAS_PIX_QR_TIMEOUT_MS`),
`GET /payments?pixQrCodeId=` (consultar) e `DELETE /pix/qrCodes/static/{id}` (cancelar, só se não
recebeu).

### Webhook do gateway — entradas (`ativacao:`, `acordo:`, `novacao:`)

Decisão de 15/11 (doc 02 §32.6): pagamento em parte vale só para fatura. Em
`PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` dessas referências o webhook continua respondendo **202** e
enfileirando (`ativar`, `efetivar`, `novacao-recebida`), agora com `valorRecebido` (centavos, de
`payment.value`) e `pagamentoId` (`payment.id`) no job. Quem efetiva compara com a entrada
cobrada: abaixo dela **não ativa nem efetiva**, grava auditoria `entrada_paga_a_menor` (uma vez
por pagamento) e emite notificação `FALHA` para a área Carteira e cobrança. O resultado do job
é `entrada_a_menor`.

### Operador (autenticado)

| Método | Rota | Área / papéis | O que faz |
|---|---|---|---|
| GET | `/api/v1/faturamento/parametros` | Configurações | `{ vigente, faturasEmAberto { azit, asaasNativo }, recebimentoPix { simulado, disponivel, chaveMascarada, tipoChave, motivo }, historico[] }`; `vigente.modoPix` = `ESTATICO` (padrão) ou `COBRANCA` |
| POST | `/api/v1/faturamento/parametros` | Configurações · ADMIN, DIRETOR | Salva **nova versão**. Campos opcionais: `pixSobDemanda`, `modoPix` (`ESTATICO` \| `COBRANCA`), `multaPadraoPct`, `atualizacaoMesPadraoPct`, `cascata` (os 4 grupos), `minimoParcialPct`, `minimoParcialPiso` (centavos), `tetoIntencoesDia`, `motivo`. 400 `validacao` / `sem_alteracao` |
| GET | `/api/v1/faturas/:id` | Carteira e cobrança, ficha | Passa a trazer `modeloEncargo` e, em fatura AZIT, `azit { situacao, totalHoje, saldoNominal, multa, atualizacao, diasAtraso, pagoTotal, pagamentos[] (com alocacoes[]), intencoesAtivas[], contaMista, gatewaySimulado }` |
| POST | `/api/v1/contas/:contaId/pix/conferir` | Carteira e cobrança, ficha · ADMIN, OPERADOR, FINANCEIRO, DIRETOR | 202. Pergunta ao gateway pelos Pix recentes da conta e enfileira a baixa dos pagos: `{ conferidas, enfileiradas, simulado }` |
| POST | `/api/v1/faturas/:id/gerar-cobranca` | — | Fatura AZIT → 422 `fatura_pix_sob_demanda` |
| POST | `/api/v1/dev/simular-pagamento-pix/:intencaoId` | fora de produção · ADMIN, OPERADOR | 202. Enfileira `identificar` com o id do Pix da intenção — o mesmo caminho do webhook do QR estático |

`POST /api/v1/dev/fechar-faturas` devolve agora `{ fechadas, modelo }` (`AZIT` com a chave ligada).

### Operações com fatura AZIT paga em parte (doc 02 §32.12 item 12)

Acordo, novação, rescisão e sinistro passam a calcular a parcela de fatura AZIT pelo saldo do
motor (as rotas e os formatos não mudaram; mudam os valores quando há Pix parcial). Ao efetivar,
as intenções ativas da conta viram `SUBSTITUIDA` e o cancelamento vai para a fila
`intencao-pagamento` (job `cancelar`).

| Rota | Mudança |
|---|---|
| Simulação e efetivação de quitação antecipada | 422 `parcela_em_fatura_pix_sob_demanda` quando alguma parcela pedida está em fatura AZIT `FECHADA`; `mensagem` cita as parcelas e as faturas |
| `GET /api/v1/faturas/:id` | `azit.pagamentos[].origem` ganha o valor `SINISTRO` (baixa pela indenização, sem Pix) |

Migração `20261115200000_fatura_azit_origem_sinistro`: `ALTER TYPE "OrigemPagamentoFatura" ADD VALUE 'SINISTRO'`.

### Variáveis de ambiente novas (backend)

| Variável | Padrão | Uso |
|---|---|---|
| `FATURA_RECEBEDOR_NOME` | `Azit Comércio de Veículos Ltda` | Recebedor mostrado ao lado do Pix e no PDF |
| `FATURA_RECEBEDOR_CNPJ` | `57.265.780/0001-19` | idem |
| `ASAAS_PIX_QR_TIMEOUT_MS` | `8000` (1000–60000) | Limite de tempo da geração do código Pix: a criação do QR estático e, no modo COBRANCA, a consulta do código da cobrança. O homolog usa 30000 para medir |

---

## 6-G. Rescisão direta, custos da recuperação e boleto do saldo — doc 02 §29 / §29.3 (20–21/11/2026)

Valores em **centavos**. A conta do acerto é `calcularAcertoRescisao` / `reaplicarCustosNoAcerto`
(`@azit/utils`); a API só transporta.

### Custos da recuperação (lançamento de custo do veículo ligado ao contrato)

| Rota | Papéis | O que faz |
|---|---|---|
| `GET /api/v1/contratos/:id/custos-recuperacao` | área do contrato | Lista `{ motivoSemLancamento, motivoClienteTravado, custos[], totais{cliente, clienteOrcado, azit} }`. Os dois motivos dizem à tela o que NÃO mostrar. |
| `POST /api/v1/contratos/:id/custos-recuperacao` | ADMIN, DIRETOR, OPERADOR | Lança. Corpo: `tipo` (lista `TIPOS_CUSTO_RECUPERACAO` de `@azit/types`), `descricao`, `valor`, `data?` (`YYYY-MM-DD`, não futura), `fornecedor?`, `situacao` (`ORCADO`\|`PAGO`), `quemPaga` (`CLIENTE`\|`AZIT`), `comprovante?` `{ nome, conteudo }` (base64). Cabe em contrato com veículo, **Ativo** ou **encerrado por rescisão**. |
| `PATCH /api/v1/custos-recuperacao/:id` | idem | Altera qualquer campo (parcial); novo `comprovante` substitui o anterior. |
| `DELETE /api/v1/custos-recuperacao/:id` | idem | Retira (soft delete). |
| `GET /api/v1/custos-recuperacao/:id/comprovante` | área do contrato | Devolve o arquivo. |

- Custo do **cliente** em contrato já rescindido: cada mudança recalcula o acerto (mesmo crédito,
  mesmas parcelas e multas) e grava uma linha em `ajustes` — **sem aprovação**.
- `422 acerto_liquidado`: a devolução ao cliente já foi registrada ou o saldo já foi pago — custo do
  cliente não entra, não muda e não sai. Custo que a Azit assume continua livre.
- `DELETE /api/v1/centros-custo/lancamentos/:id` (ficha do veículo) recusa custo da recuperação com
  `422 custo_do_contrato`: ele só sai pela ficha do contrato.

### Rescisão

| Rota | Papéis | O que faz |
|---|---|---|
| `GET /api/v1/contratos/:id/rescisao/previa?dataBase=` | área do contrato | Acerto na data + `consequencias { cobrancasNoAr, outrosContratosAtivos, multasFora }` para a confirmação. Não exige parcela vencida. |
| `POST /api/v1/contratos/:id/rescisao` | **ADMIN, DIRETOR** | **Efetiva na hora, sem aprovação.** Corpo: `dataBase?` (dia em que o carro voltou), `origem?` (`RETOMADA`\|`DEVOLUCAO`), `observacao?`. Resposta `201 { id, status: 'efetivada', numero, acerto, avisos }`. `422 ja_pendente` se houver pedido antigo aguardando na Central. |
| `GET /api/v1/contratos/:id/rescisoes` | área do contrato | Além do que já vinha: `origem`, `efetivadaPorNome`, `ajustes[]`, `cobrancaSaldo { valor, vencimento, emitidaEm, link, vencida, desatualizada } \| null`, `saldoPagoEm`, `saldoValorPago`. |
| `POST /api/v1/rescisoes/:id/boleto-saldo` | ADMIN, DIRETOR, OPERADOR, FINANCEIRO | Emite o **boleto único** do saldo remanescente (`billingType: BOLETO`, vencimento em 15 dias úteis, `externalReference: rescisao:<id>`). `422 sem_saldo` / `ja_pago` / `ja_emitido`; `502 asaas_recusou` quando o Asaas não aceita. |
| `POST /api/v1/rescisoes/:id/devolucao` | ADMIN, OPERADOR, FINANCEIRO | Inalterado (registra a devolução feita). |

No acerto (`AcertoRescisao`) entram os campos `custos[]`, `custosCliente`, `custosOrcados`,
`multas[]`, `multasVeiculo`; `dividaTotal` passa a somar tudo. Acertos gravados antes de 20/11 não
têm esses campos (a tela trata como zero).

### Webhook do gateway — referência `rescisao:<id>`

- `PAYMENT_RECEIVED` / `PAYMENT_CONFIRMED` → fila `efetivar-acordo`, job `rescisao-saldo-recebido`:
  marca o saldo como pago, cria `LancamentoConta` do tipo `SALDO_RESCISAO` (entra no caixa da
  Carteira como `saldosRescisao`) e avisa a carteira. Idempotente.
- `PAYMENT_OVERDUE` → job `rescisao-saldo-vencido`: marca o boleto como vencido e avisa a carteira
  (a negativação é feita à mão no painel do Asaas). Aviso de boleto já substituído é ignorado.
- Qualquer outro evento dessa referência é só recebido — nunca vai para a fila de fatura.

---

## 6-H. WhatsApp — canal, lembretes de pagamento e Conversas — doc 02 §23, §24 e §28 (15/11/2026)

**Canal (Configuração › WhatsApp — área CONFIGURACOES, ADMIN/DIRETOR)**
- `GET /whatsapp/parametros` → `{ versao, ativo, numerosAutorizados[], modelos: [{ momento, nome, idioma, cadastro: { categoria, corpo, variaveis[], botaoTexto, botaoUrl, botaoVariavel } }], janela: { inicio, fim }, alteradoEm, alteradoPor, ambiente: { producao, credencialConfigurada } }`.
  `versao: 0` = padrões (nunca salvo). Nenhum segredo.
- `PUT /whatsapp/parametros { ativo?, numerosAutorizados?, modeloD2Nome?, modeloD2Idioma?, modeloD0Nome?, modeloD0Idioma? }`
  → grava uma **versão nova** e devolve a tela. 422: `numeros_invalidos`, `modelo_invalido`, `idioma_invalido`,
  `sem_credencial` (produção não liga os envios sem credencial).
- **22/11 (§28.6):** `modelos[]` ganha o momento `D_MAIS_2` (aviso de atraso; variáveis: nome, nº, vencimento,
  valor de hoje) e a tela ganha `pix: { ativo, recebedor, modelos: [{ momento: D_MENOS_2 | D_ZERO, nome, idioma,
  cadastro: { categoria, corpo, variaveis[], botaoTexto } }] }`. O `PUT` aceita também `modeloAtrasoNome?`,
  `modeloAtrasoIdioma?`, `modeloPixD2Nome?`, `modeloPixD0Nome?`, `modeloPixIdioma?`, `pixNoLembrete?` (boolean) e
  `recebedorPix?` (até 100 letras; 422 `recebedor_invalido`).
- Credenciais: `GET/PUT /integracoes` ganham o bloco `whatsapp` (`phoneNumberId`, `wabaId` inteiros;
  `accessToken`, `appSecret`, `verifyToken` write-only, só o final); `POST /integracoes/whatsapp/testar`
  lê o próprio número na Meta, sem enviar mensagem.

**Webhook da Meta (público)**
- `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → devolve o desafio em
  texto puro; 403 se o token de verificação não bate.
- `POST /webhooks/whatsapp` com `X-Hub-Signature-256: sha256=<HMAC do corpo com o segredo do aplicativo>` →
  `200 { recebido: true }` e enfileira (fila `whatsapp`, job `evento-meta`). 401: `assinatura_invalida`,
  `webhook_sem_segredo` (produção sem segredo cadastrado).

**Lembretes de pagamento**
- `GET /titulares/:id/lembretes` (CARTEIRA_COBRANCA + ficha) → `{ whatsapp, whatsappValido, conversa: { numero,
  mensagens, naoLidas } (atalho para a conversa), lembrete: { ativo,
  ligadoEm, ligadoPor, desligadoEm, desligadoPor }, avisoAsaas: { desligado, alteradoEm, alteradoPor, pendente,
  clienteNoAsaas }, semAvisoNenhum, canal: { enviosAutomaticos, producao, decisao: ENVIA | SIMULADO | RETIDO,
  motivo, enviaDeVerdade }, lembretes: [{ id, faturaId, faturaNumero, vencimento, momento: D_MENOS_2 | D_ZERO | D_MAIS_2,
  situacao: PREPARADO | ENVIADO | ENTREGUE | LIDO | FALHOU | SIMULADO | RETIDO, motivo, destino, texto, modelo,
  comPix (levou o Pix copia e cola — §28.6), registradoEm, enviadoEm, entregueEm, lidoEm, falhaEm }] }`.
- Pix no lembrete (§28.6): a intenção de pagamento nasce com `origem: LEMBRETE` e `ateDia` = dia do vencimento
  (as demais: `ateDia` = dia em que nasceram). Reuso, virada do dia e "ativas da conta" leem `ateDia`; o teto
  diário de valores distintos não conta as de origem LEMBRETE.
- `POST /titulares/:id/lembretes/ligar` · `POST /titulares/:id/lembretes/desligar` (CARTEIRA_COBRANCA) →
  mesma resposta do GET. 422: `whatsapp_invalido`.
- `POST /titulares/:id/lembretes/aviso-asaas { desligado: boolean }` (CARTEIRA_COBRANCA) → altera
  `notificationDisabled` no cadastro do cliente no Asaas (ou registra a decisão, se o cliente ainda não existe lá).
  422: `lembrete_desligado` (só desliga o Asaas com o lembrete ligado), `asaas_recusou`.
- `GET /whatsapp/lembretes/resumo` (CONFIGURACOES, CARTEIRA_COBRANCA) → `{ dia, titularesComLembrete,
  hoje: { <situacao>: n }, retidos, ultimos[] }`.
- Fora de produção: `POST /dev/whatsapp/lembretes/varrer` (roda a varredura ignorando a janela; devolve
  `{ dia, executada, motivo, candidatas, enviados, simulados, retidos, falhas, ignoradas }`) e
  `POST /dev/whatsapp/lembretes/:id/simular-status { status: delivered | read | failed }`.

**Conversas (área CARTEIRA_COBRANCA) — doc 02 §24 e §34 (atendimento, 25/11/2026)**
- `GET /conversas-whatsapp` → `[{ numero (canônico), titular, lead, nomePerfil, etiqueta: CLIENTE | EX_CLIENTE | LEAD |
  NAO_CADASTRADO, ultimaEm, ultimaOrigem: mensagem | lembrete, ultimaDirecao, ultimaPrevia, naoLidas, respondeu }]`.
  Entra todo número com mensagem **ou** lembrete enviado (ENVIADO/ENTREGUE/LIDO/SIMULADO); ordem pela **última
  atividade** (o lembrete conta), sem fixar as não lidas. Etiqueta derivada na leitura (`etiquetaDoContato`).
- `GET /conversas-whatsapp/nao-lidas` → `{ total }` (contador do menu).
- `GET /conversas-whatsapp/:numero` → `{ numero, titular, contaId, lead: { id, nome, cpf, canalOrigem, criadoEm } | null,
  nomePerfil, etiqueta, respondeu, contratos[] (ativos), historico: [{ id, numero, status, motivoEncerramento,
  dataEncerramento, ativo }], simulacoes: [{ id, criadaEm, validaAte, veiculo, valorAvista, oferta: { valorEntrada,
  prazoMeses, frequencia, valorParcela } | null, propostaId }], janela: { aberta, ate, horas }, envio: { producao,
  decisao, motivo, enviaDeVerdade }, itens: [{ id, origem: mensagem | lembrete, direcao: ENTRADA | SAIDA, momento,
  tipo, texto, temMidia, midiaDisponivel, midiaNome, situacao, motivo, autor, lida }] }`.
- `POST /conversas-whatsapp/:numero/lida` → `{ marcadas }` (manda o visto azul pela regra de envio).
- `POST /conversas-whatsapp/:numero/nao-lida` → `{ naoLidas: 1 }`: a última mensagem recebida volta a não lida, só no sistema (doc 02 §34.2). 422 `sem_mensagem_recebida` se o cliente nunca escreveu.
- `POST /conversas-whatsapp/:numero/responder { texto }` → `{ resultado: enviada | simulada | retida | falhou, motivo? }`.
  422: `janela_fechada`, `texto_invalido`, `numero_invalido`.
- `POST /conversas-whatsapp/:numero/anexo { tipo: IMAGEM | DOCUMENTO | AUDIO, nome, mime, conteudoBase64, legenda? }` →
  `{ resultado, motivo? }`. Imagem JPG/PNG até 5 MB; documento PDF/Word/Excel/texto até 20 MB; áudio até 5 MB
  (gravação de até 5 min), convertido no servidor para ogg/opus (ffmpeg) e enviado como voz, sem legenda. Sobe para
  a Meta em `/{phone-number-id}/media` e sai pela regra única de envio. 422: `janela_fechada`, `anexo_invalido`,
  `audio_sem_conversao` (só quando o envio seria real; simulado guarda o original).
- `POST /conversas-whatsapp/:numero/simulacao { texto, pdf?: { titulo, destaque?: { rotulo, valor }, linhas: [{ rotulo,
  valor }], observacoes?: string[] } }` → `{ pdf: { resultado, motivo? } | null, texto: { resultado, motivo? } }`.
  O PDF (opcional) leva só as linhas que a tela recebeu do serviço da simulação; sai antes do texto. 422: `janela_fechada`,
  `texto_invalido`.
- `GET /conversas-whatsapp/midia/:id` → arquivo recebido do cliente ou enviado pela tela.
- Fora de produção: `POST /dev/conversas-whatsapp/simular-entrada { numero, texto }`.
- O painel de atendimento usa as rotas que já existem: `POST /leads` (COMERCIAL; `cpf` opcional desde 25/11, canal
  `whatsapp`), `PATCH /leads/:id/cpf { cpf }` (COMERCIAL, nova: grava o CPF do lead registrado sem ele →
  `{ tipo: lead, lead }`, ou `{ tipo: titular, titular: { id, nome } }` sem gravar quando o CPF já é de um titular;
  422 `cpf_invalido`), `GET /ativos?oferecivel=true` (Disponível + Em preparação, com o alerta — doc 02 §25.8), `POST /simulacoes` (**CPF obrigatório para simular**:
  `leadId` de lead sem CPF → 422 `lead_sem_cpf`), `POST /simulacoes/:id/opcoes`,
  `GET /contas/:id/posicao`, `GET /contas/:id/faturas?visao=agora`, `POST /faturas/:id/envios-link`,
  `GET /contas/:id/renegociacao/elegivel`, `POST /contas/:id/renegociacao/simular`, `POST /contas/:id/novacao/simular`
  e `POST /contratos/:id/quitacao/simular`.
