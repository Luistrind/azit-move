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

## 2. API de Originação — PopHub → Azit Move

Esta é a integração principal. O PopHub envia o contrato no momento da assinatura e o sistema Azit Move processa tudo a partir daí.

### POST `/api/v1/contratos/originar`

Recebe um contrato completo do PopHub e executa:
- Criação ou identificação do cliente e conta
- Vínculo do ativo ao contrato
- Conciliação da entrada
- Geração do cronograma completo de parcelas e recebíveis
- Criação das faturas futuras
- Ativação do contrato

#### Request Body

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

  "interveniente_garantidor": null,

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
- `contrato.numero_origem` — identificador único vindo do PopHub
- `contrato.data_assinatura`
- `contrato.data_primeira_parcela`
- `cliente.cpf_cnpj` — chave primária de identificação
- `cliente.nome`
- `cliente.whatsapp`
- `ativo.chassi` — chave primária de identificação do ativo
- `itens_contratados` — mínimo um item do tipo `parcelamento_veiculo`

> **Nota de nomenclatura:** o bloco `cliente` no payload designa o **titular** no papel de comprador. Internamente, o sistema cria ou identifica um `Titular` (pelo CPF/CNPJ) e sua `Conta`, e gera um `ContratoCredito`. O nome do bloco no payload é mantido como `cliente` por ser o termo que o PopHub usa na originação; o contrato de integração final (a definir com a equipe do PopHub) pode alinhar esse nome para `titular`.

#### Campos Opcionais
- `interveniente_garantidor` — presente apenas quando o contrato tem garantidor
- `cliente.asaas_customer_id` — se não informado, sistema busca pelo CPF no Asaas
- `entrada.asaas_payment_id` — referência do pagamento da entrada no Asaas
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

### POST `/api/v1/contratos/originar` — Com Interveniente Garantidor

Mesmo endpoint. Quando há garantidor, o campo `interveniente_garantidor` é preenchido:

```json
{
  "interveniente_garantidor": {
    "nome": "Vania Teodoro Moreira",
    "cpf": "07305936650",
    "rg": "07305936650",
    "estado_civil": "casado",
    "profissao": "Cozinheira",
    "whatsapp": "5531973047609",
    "email": "vaniapedra6@gmail.com",
    "endereco": "Rua Ceará",
    "numero": "454",
    "complemento": "Casa",
    "bairro": "Morada da Barra",
    "cidade": "Vila Velha",
    "estado": "ES",
    "cep": "29126529"
  }
}
```

---

## 3. Webhooks do Asaas → Azit Move

O Asaas envia webhooks para o sistema em eventos de pagamento. O sistema deve processar e atualizar status em tempo real.

### POST `/api/v1/webhooks/asaas`

Endpoint receptor de todos os webhooks do Asaas.

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

#### Evento: Entrada de Renegociação Paga — `PAYMENT_RECEIVED` (acordo)

Mesmo evento de pagamento confirmado. O `externalReference` diferencia:
- `fatura_uuid` → pagamento de fatura normal
- `acordo_uuid` → pagamento de entrada de renegociação

**Processamento para acordo:**
1. Identifica o acordo pelo `externalReference`
2. Efetiva a renegociação:
   - Acordo: Rascunho → Ativo
   - Faturas cobertas → Renegociadas
   - Parcelas cobertas → Renegociadas
   - Novas parcelas → Em aberto
   - Contrato → Ativo (se todas obrigações cobertas)

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
  "pophub_id": "2026040001",
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

### 4.4 Renegociação

#### GET `/api/v1/contratos/:id/obrigacoes-abertas`
Lista todas as obrigações em aberto do contrato para seleção na renegociação.

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
Cria um acordo de renegociação em rascunho.

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

#### GET `/api/v1/acordos/:id`
Detalhes de um acordo.

#### PATCH `/api/v1/acordos/:id/cancelar`
Cancela um acordo em rascunho.

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

**Query params:** `status`, `placa`, `chassi`, `page`, `limit`

#### POST `/api/v1/ativos`
Cadastra um novo ativo no sistema.

#### GET `/api/v1/ativos/:id`
Detalhes do ativo.

#### PATCH `/api/v1/ativos/:id`
Atualiza dados do ativo (ex: quilometragem, status).

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
  "mensagem": "Não é possível renegociar um contrato em rascunho",
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

Necessário em situações como: renegociação aprovada (cancela cobranças das faturas cobertas), erro de geração, estorno de contrato.

**DELETE** `https://api.asaas.com/v3/payments/{asaas_charge_id}`

**Response:** `200 OK` com `{ "deleted": true }`

**Quando executar:**
- Renegociação efetivada → cancelar cobranças das faturas cobertas no Asaas
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
