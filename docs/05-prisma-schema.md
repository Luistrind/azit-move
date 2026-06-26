# Doc 5 — Prisma Schema
## Azit Move V3

**Versão:** 1.0  
**Data:** jun/2025  
**Status:** Aprovado para implementação  
**Localização do arquivo:** `apps/backend/prisma/schema.prisma`

---

## Sumário

1. Decisões de modelagem
2. Configuração base
3. Enums
4. Modelos — camada do titular
5. Modelos — camada do ativo e capital
6. Modelos — cobrança e financeiro
7. Modelos — renegociação e reajuste
8. Modelos — operação e autenticação
9. Índices e performance
10. Schema completo
11. Notas de implementação

---

## 1. Decisões de modelagem

Estas decisões foram validadas antes da geração do schema e devem ser respeitadas em qualquer alteração futura.

### 1.1 Soft delete vs hard delete

| Estratégia | Entidades |
|---|---|
| **Soft delete** (campo `deletedAt`) | Titular, Conta, ContratoCredito, ContratoInvestimento, Fatura, Parcela, Acordo, Ativo, ItemContratado, Recebível |
| **Hard delete** (remoção real) | RefreshToken, logs, registros efêmeros |

Toda query nas entidades com soft delete deve filtrar `deletedAt: null`. Recomenda-se usar a extensão de query do Prisma para aplicar esse filtro globalmente e evitar esquecimento.

### 1.2 Status calculados de Parcela

O enum `StatusParcela` no banco contém **apenas os estados armazenáveis**: Paga, Paga em atraso, Paga antecipada, Renegociada, Cancelada, Estornada, Suspensa.

Os estados **Em aberto**, **Vence hoje** e **Vencida** são calculados em runtime comparando `dataVencimento` com a data atual. Nunca são gravados no banco. Isso elimina o risco de status desatualizado entre execuções de jobs.

Uma parcela sem `status` definido (null) é interpretada como "em aberto/vence hoje/vencida" conforme a data. Assim que paga, cancelada, etc., o campo recebe o valor real.

### 1.3 Tipos monetários

Todos os valores monetários usam `Decimal @db.Decimal(12, 2)` — nunca `Float`. Float introduz erros de arredondamento inaceitáveis em sistema financeiro.

### 1.4 Identificadores

Chaves primárias usam `cuid()` — identificadores únicos, ordenáveis e seguros para exposição em URLs. Não usar UUID v4 (não ordenável) nem auto-increment (expõe volume e é previsível).

### 1.5 Timestamps

Todas as entidades têm `createdAt` e `updatedAt` automáticos. As entidades com soft delete adicionam `deletedAt` nullable.

### 1.6 Renegociação como novação

A renegociação segue o modelo bancário de novação: as parcelas antigas são extintas (marcadas como `RENEGOCIADA`) e o acordo gera um **ItemContratado novo** de origem `RENEGOCIACAO` que contém as parcelas novas. A renegociação não altera as parcelas antigas nem cria parcelas soltas — cria um novo crédito que as quita. Detalhamento completo na seção 11.5.

---

## 2. Configuração base

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

---

## 3. Enums

```prisma
enum TipoPessoa {
  PF
  PJ
}

enum StatusTitular {
  ATIVO
  INATIVO
  BLOQUEADO
}

enum StatusConta {
  ATIVA
  SUSPENSA
  ENCERRADA
}

enum TipoAtivo {
  VEICULO
  OUTRO
}

enum StatusAtivo {
  DISPONIVEL
  EM_CONTRATO
  QUITADO
  RECUPERADO
  SINISTRADO
}

enum TipoCombustivel {
  FLEX
  GASOLINA
  ELETRICO
  DIESEL
  HIBRIDO
}

enum OrigemAtivo {
  LOCADORA
  PARTICULAR
  CONCESSIONARIA
}

enum TipoOrigemCapital {
  CAPITAL_PROPRIO
  EMPRESTIMO
  INVESTIDOR_ATIVO
  FUNDO
}

enum StatusOrigemCapital {
  ATIVO
  ENCERRADO
}

// Modelo do contrato de investimento (espelha o antigo tipo_investidor)
enum ModeloInvestimento {
  ATIVO_ESPECIFICO
  FUNDO_COLETIVO
  FUNDO_EXCLUSIVO
}

enum StatusContratoInvestimento {
  ATIVO
  ENCERRADO
}

enum Periodicidade {
  SEMANAL
  QUINZENAL
  MENSAL
}

enum StatusContratoCredito {
  RASCUNHO
  AGUARDANDO_ASSINATURA
  AGUARDANDO_PAGAMENTO_INICIAL
  AGUARDANDO_ENTREGA_VEICULO
  ATIVO
  INADIMPLENTE
  BLOQUEADO
  SUSPENSO
  EM_RECUPERACAO_VEICULO
  CANCELADO
  RESCINDIDO
  QUITADO_AGUARDANDO_TRANSFERENCIA
  QUITADO_TRANSFERENCIA_EFETIVADA
}

enum MotivoEncerramento {
  QUITACAO
  RESCISAO
  CANCELAMENTO
}

enum NaturezaProduto {
  RECORRENTE
  PARCELADO
}

// De onde o item nasceu. Diferencia produtos vendidos de créditos de renegociação.
enum OrigemItemContratado {
  VENDA           // produto vendido na originação ou pós-venda (veículo, proteção, crédito avulso)
  RENEGOCIACAO    // crédito gerado por um acordo (novação das parcelas antigas)
}

enum Credor {
  AZIT
  INVESTIDOR
  TERCEIRO
}

enum StatusItemContratado {
  ATIVO
  ENCERRADO
  CANCELADO
}

// Apenas estados ARMAZENÁVEIS.
// Em aberto / Vence hoje / Vencida são calculados em runtime — nunca gravados.
enum StatusParcela {
  PAGA
  PAGA_EM_ATRASO
  PAGA_ANTECIPADA
  RENEGOCIADA
  CANCELADA
  ESTORNADA
  SUSPENSA
}

enum StatusFatura {
  ABERTA
  FECHADA
  VENCIDA
  PAGA
  PAGA_EM_ATRASO
  RENEGOCIADA
}

enum TipoItemFatura {
  PRINCIPAL
  SERVICO
  ENCARGO
}

enum StatusRecebivel {
  ESPERADO
  REALIZADO
  RENEGOCIADO
  CANCELADO
}

enum StatusAcordo {
  RASCUNHO
  ATIVO
  QUITADO
  CANCELADO
}

enum StatusReajuste {
  PENDENTE
  APROVADO
  APLICADO
  CANCELADO
}

enum RoleUsuario {
  DIRETOR
  ADMIN
  APROVADOR
  OPERADOR
  FINANCEIRO
  // Papéis externos (titular como cliente / investidor) são derivados do que a
  // conta possui — não são roles deste enum. Ver Doc 6.
}
```

> **Nota sobre roles.** Um usuário tem **múltiplos roles** (ex: um diretor que também é admin e aprovador acumula os três), seguindo RBAC clássico onde as permissões se somam. Isso está modelado via a tabela de junção `UsuarioRole` (relação muitos-para-muitos), não um campo único. O enum acima lista os papéis **internos**. Os papéis **externos** — titular como "cliente" (tem ContratoCredito) ou "investidor" (tem ContratoInvestimento) — são derivados do que a conta possui e não fazem parte deste enum. A estrutura completa de permissões por endpoint e de alçadas configuráveis (quem aprova o quê, com que limite) é o conteúdo do **Doc 6 (Autenticação e Permissões)**, a detalhar com Vini.

---

## 4. Modelos — camada do titular

```prisma
model Titular {
  id              String        @id @default(cuid())
  nome            String
  tipoPessoa      TipoPessoa
  cpfCnpj         String        @unique
  rg              String?
  estadoCivil     String?
  profissao       String?
  whatsapp        String
  email           String?
  endereco        String?
  bairro          String?
  cidade          String?
  estado          String?
  cep             String?
  asaasCustomerId String?       @unique
  status          StatusTitular @default(ATIVO)

  conta                   Conta?
  intervenienteGarantidor IntervenienteGarantidor?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([cpfCnpj])
  @@index([asaasCustomerId])
  @@map("titulares")
}

model IntervenienteGarantidor {
  id        String  @id @default(cuid())
  titularId String  @unique
  nome      String
  cpf       String
  rg        String?
  whatsapp  String?
  email     String?
  endereco  String?
  bairro    String?
  cidade    String?
  estado    String?
  cep       String?

  titular Titular @relation(fields: [titularId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("intervenientes_garantidores")
}

model Conta {
  id           String      @id @default(cuid())
  titularId    String      @unique
  dataAbertura DateTime    @default(now())
  status       StatusConta @default(ATIVA)

  titular              Titular               @relation(fields: [titularId], references: [id])
  contratosCredito     ContratoCredito[]
  contratosInvestimento ContratoInvestimento[]
  faturas              Fatura[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@map("contas")
}
```

---

## 5. Modelos — camada do ativo e capital

```prisma
model Ativo {
  id                   String           @id @default(cuid())
  tipo                 TipoAtivo        @default(VEICULO)
  descricao            String
  marca                String?
  modelo               String?
  anoFabricacao        Int?
  anoModelo            Int?
  cor                  String?
  placa                String?          @unique
  chassi               String?          @unique
  renavam              String?
  origem               OrigemAtivo?
  combustivel          TipoCombustivel?
  quilometragemEntrada Int?
  valorAquisicao       Decimal?         @db.Decimal(12, 2)
  status               StatusAtivo      @default(DISPONIVEL)

  origemCapital   OrigemCapital?
  contratoCredito ContratoCredito?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([chassi])
  @@index([placa])
  @@map("ativos")
}

model OrigemCapital {
  id                     String              @id @default(cuid())
  ativoId                String              @unique
  tipo                   TipoOrigemCapital
  // Quando tipo = INVESTIDOR_ATIVO ou FUNDO, aponta para o contrato de investimento
  // do titular-investidor que financia este ativo.
  contratoInvestimentoId String?
  valorAportado          Decimal             @db.Decimal(12, 2)
  taxaRetorno            Decimal?            @db.Decimal(8, 6)
  dataAporte             DateTime
  status                 StatusOrigemCapital @default(ATIVO)

  ativo                Ativo                 @relation(fields: [ativoId], references: [id])
  contratoInvestimento ContratoInvestimento? @relation(fields: [contratoInvestimentoId], references: [id])
  recebiveis           Recebivel[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([contratoInvestimentoId])
  @@map("origens_capital")
}

// Instrumento de investimento do titular. Espelho do ContratoCredito, fluxo invertido:
// o titular aporta capital e a Azit devolve com rendimento. Pendurado na Conta.
model ContratoInvestimento {
  id                  String                     @id @default(cuid())
  numero              String                     @unique
  contaId             String
  modelo              ModeloInvestimento
  valorAportado       Decimal                    @db.Decimal(12, 2)
  taxaRetorno         Decimal?                   @db.Decimal(8, 6)
  dataAporte          DateTime
  dataInicio          DateTime
  dataVencimento      DateTime?
  capitalAmortizado   Decimal                    @default(0) @db.Decimal(12, 2)
  rendimentoAcumulado Decimal                    @default(0) @db.Decimal(12, 2)
  status              StatusContratoInvestimento @default(ATIVO)

  conta          Conta           @relation(fields: [contaId], references: [id])
  origensCapital OrigemCapital[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([contaId])
  @@index([modelo])
  @@index([status])
  @@map("contratos_investimento")
}
```

---

## 6. Modelos — cobrança e financeiro

```prisma
model ContratoCredito {
  id                   String                 @id @default(cuid())
  numero               String                 @unique
  contaId              String
  ativoId              String                 @unique
  pophubId             String?
  dataAssinatura       DateTime
  dataPrimeiraParcela  DateTime
  valorTotal           Decimal                @db.Decimal(12, 2)
  valorEntrada         Decimal                @default(0) @db.Decimal(12, 2)
  saldoDevedor         Decimal                @db.Decimal(12, 2)
  numeroParcelas       Int
  valorParcelaInicial  Decimal                @db.Decimal(12, 2)
  periodicidade        Periodicidade          @default(SEMANAL)
  indiceReajuste       String?
  taxaMultaAtraso      Decimal                @default(2.0) @db.Decimal(5, 2)
  taxaJurosAtraso      Decimal                @default(1.0) @db.Decimal(5, 2)
  taxaDescontoQuitacao Decimal?               @db.Decimal(8, 6)
  status               StatusContratoCredito  @default(RASCUNHO)
  dataEncerramento     DateTime?
  motivoEncerramento   MotivoEncerramento?
  asaasSubscriptionId  String?

  conta            Conta            @relation(fields: [contaId], references: [id])
  ativo            Ativo            @relation(fields: [ativoId], references: [id])
  itensContratados ItemContratado[]
  parcelas         Parcela[]
  recebiveis       Recebivel[]
  acordos          Acordo[]
  reajustes        ReajusteIPCA[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([contaId])
  @@index([numero])
  @@index([status])
  @@index([pophubId])
  @@map("contratos_credito")
}

model ItemContratado {
  id            String               @id @default(cuid())
  contratoId    String
  descricao     String
  natureza      NaturezaProduto
  origem        OrigemItemContratado @default(VENDA)
  acordoOrigemId String?             @unique
  credor        Credor               @default(AZIT)
  credorId      String?
  valor         Decimal              @db.Decimal(12, 2)
  numeroParcelas Int?
  periodicidade Periodicidade?
  dataInicio    DateTime
  dataFim       DateTime?
  status        StatusItemContratado @default(ATIVO)

  contrato     ContratoCredito @relation(fields: [contratoId], references: [id])
  acordoOrigem Acordo?   @relation("ItemGeradoPorAcordo", fields: [acordoOrigemId], references: [id])
  parcelas     Parcela[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([contratoId])
  @@index([origem])
  @@map("itens_contratados")
}

model Parcela {
  id               String         @id @default(cuid())
  contratoId       String
  itemContratadoId String
  numero           Int
  totalParcelas    Int
  display          String
  valorNominal     Decimal        @db.Decimal(12, 2)
  dataVencimento   DateTime
  dataPagamento    DateTime?
  valorPago        Decimal?       @db.Decimal(12, 2)
  valorEncargo     Decimal?       @db.Decimal(12, 2)
  // status NULL = em aberto/vence hoje/vencida (calculado em runtime pela data)
  status           StatusParcela?
  faturaId         String?
  // acordoId: preenchido SOMENTE nas parcelas ANTIGAS extintas por um acordo (status = RENEGOCIADA).
  // As parcelas NOVAS do acordo não usam este campo — elas pertencem ao ItemContratado
  // de origem RENEGOCIACAO que o acordo gerou.
  acordoId         String?

  contrato         ContratoCredito @relation(fields: [contratoId], references: [id])
  itemContratado   ItemContratado @relation(fields: [itemContratadoId], references: [id])
  fatura           Fatura?        @relation(fields: [faturaId], references: [id])
  acordoRenegociou Acordo?        @relation("ParcelasRenegociadas", fields: [acordoId], references: [id])
  recebivel        Recebivel?
  itensFatura      ItemFatura[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([contratoId])
  @@index([itemContratadoId])
  @@index([faturaId])
  @@index([dataVencimento])
  @@index([status])
  @@map("parcelas")
}

model Fatura {
  id                String       @id @default(cuid())
  contaId           String
  numero            Int
  periodoReferencia DateTime
  dataFechamento    DateTime
  dataVencimento    DateTime
  dataPagamento     DateTime?
  valorTotal        Decimal      @default(0) @db.Decimal(12, 2)
  valorPago         Decimal?     @db.Decimal(12, 2)
  status            StatusFatura @default(ABERTA)
  asaasChargeId     String?
  acordoId          String?

  conta       Conta        @relation(fields: [contaId], references: [id])
  itensFatura ItemFatura[]
  parcelas    Parcela[]
  acordo      Acordo?      @relation(fields: [acordoId], references: [id])

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([contaId])
  @@index([status])
  @@index([dataVencimento])
  @@index([asaasChargeId])
  @@map("faturas")
}

model ItemFatura {
  id        String         @id @default(cuid())
  faturaId  String
  parcelaId String
  tipo      TipoItemFatura
  descricao String
  valor     Decimal        @db.Decimal(12, 2)
  credor    Credor         @default(AZIT)
  credorId  String?

  fatura  Fatura  @relation(fields: [faturaId], references: [id])
  parcela Parcela @relation(fields: [parcelaId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([faturaId])
  @@index([parcelaId])
  @@map("itens_fatura")
}

model Recebivel {
  id                  String          @id @default(cuid())
  contratoId          String
  parcelaId           String          @unique
  origemCapitalId     String
  dataPrevista        DateTime
  valorPrevisto       Decimal         @db.Decimal(12, 2)
  dataRealizada       DateTime?
  valorRealizado      Decimal?        @db.Decimal(12, 2)
  status              StatusRecebivel @default(ESPERADO)
  // Breakdown PLACEHOLDER — fórmula pendente de definição (Sebastião / estrutura do fundo)
  breakdownCapital    Decimal?        @db.Decimal(12, 2)
  breakdownRendimento Decimal?        @db.Decimal(12, 2)
  breakdownTaxaServico Decimal?       @db.Decimal(12, 2)

  contrato      ContratoCredito @relation(fields: [contratoId], references: [id])
  parcela       Parcela       @relation(fields: [parcelaId], references: [id])
  origemCapital OrigemCapital @relation(fields: [origemCapitalId], references: [id])

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([contratoId])
  @@index([origemCapitalId])
  @@index([status])
  @@index([dataPrevista])
  @@map("recebiveis")
}
```

---

## 7. Modelos — renegociação e reajuste

```prisma
model Acordo {
  id                   String       @id @default(cuid())
  contratoId           String
  operadorId           String
  dataCriacao          DateTime     @default(now())
  dataEfetivacao       DateTime?
  valorTotalRenegociado Decimal     @db.Decimal(12, 2)
  valorEntrada         Decimal      @db.Decimal(12, 2)
  numeroParcelasNovas  Int
  valorParcelaNova     Decimal      @db.Decimal(12, 2)
  asaasChargeIdEntrada String?
  status               StatusAcordo @default(RASCUNHO)
  observacao           String?

  contrato             ContratoCredito @relation(fields: [contratoId], references: [id])
  operador             Usuario         @relation(fields: [operadorId], references: [id])
  // Parcelas ANTIGAS extintas por este acordo (marcadas como RENEGOCIADA)
  parcelasRenegociadas Parcela[]       @relation("ParcelasRenegociadas")
  // Item de crédito NOVO gerado por este acordo (origem RENEGOCIACAO).
  // As parcelas novas do acordo pertencem a este item, não diretamente ao acordo.
  itemGerado           ItemContratado? @relation("ItemGeradoPorAcordo")
  faturas              Fatura[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([contratoId])
  @@index([status])
  @@index([operadorId])
  @@map("acordos")
}

model ReajusteIPCA {
  id                  String         @id @default(cuid())
  contratoId          String
  dataAniversario     DateTime
  indiceAplicado      Decimal        @db.Decimal(8, 4)
  valorParcelaAnterior Decimal       @db.Decimal(12, 2)
  valorParcelaNovo    Decimal        @db.Decimal(12, 2)
  status              StatusReajuste @default(PENDENTE)
  aprovadoPor         String?
  dataAprovacao       DateTime?
  dataAplicacao       DateTime?
  dataNotificacaoCliente DateTime?

  contrato ContratoCredito @relation(fields: [contratoId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([contratoId])
  @@index([status])
  @@map("reajustes_ipca")
}
```

---

## 8. Modelos — operação e autenticação

```prisma
model Usuario {
  id           String   @id @default(cuid())
  nome         String
  email        String   @unique
  senhaHash    String
  ativo        Boolean  @default(true)

  // Um usuário tem MÚLTIPLOS roles (ex: diretor + admin + aprovador simultaneamente).
  // A estrutura definitiva de roles/permissões e alçadas vem no Doc 6 (com Vini).
  roles         UsuarioRole[]
  acordos       Acordo[]
  refreshTokens RefreshToken[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([email])
  @@map("usuarios")
}

// Tabela de junção usuário ↔ role (RBAC). Permite acúmulo de papéis.
model UsuarioRole {
  usuarioId String
  role      RoleUsuario

  usuario Usuario @relation(fields: [usuarioId], references: [id])

  createdAt DateTime @default(now())

  @@id([usuarioId, role])
  @@map("usuario_roles")
}

model RefreshToken {
  id        String   @id @default(cuid())
  usuarioId String
  token     String   @unique
  expiraEm  DateTime
  revogado  Boolean  @default(false)

  usuario Usuario @relation(fields: [usuarioId], references: [id])

  createdAt DateTime @default(now())

  @@index([usuarioId])
  @@index([token])
  @@map("refresh_tokens")
}
```

> **Nota:** o modelo `Usuario` e a estrutura de roles são preliminares. A spec completa de autenticação (payload JWT, guards, mapeamento de permissões por endpoint) é o Doc 6, a ser definido com Vini. O schema aqui cobre o mínimo para o backend subir com autenticação funcional.

---

## 9. Índices e performance

Os índices foram definidos com base nas queries mais frequentes do sistema.

| Tabela | Índice | Query que otimiza |
|---|---|---|
| `titulares` | `cpfCnpj` | Busca de titular por documento (conciliação Asaas) |
| `titulares` | `asaasCustomerId` | Webhook do Asaas → identificar titular |
| `ativos` | `chassi`, `placa` | Identificação do veículo na originação |
| `contratos_credito` | `status` | Painel de carteira filtrado por status |
| `contratos_credito` | `pophubId` | Originação via API do PopHub |
| `contratos_investimento` | `contaId`, `modelo`, `status` | Visão de investimentos do titular |
| `parcelas` | `dataVencimento` | Job de fechamento de fatura (D-5) |
| `parcelas` | `status` | Listagem de parcelas pagas/pendentes |
| `parcelas` | `faturaId` | Baixa de parcelas ao conciliar fatura |
| `faturas` | `asaasChargeId` | Webhook do Asaas → identificar fatura |
| `faturas` | `dataVencimento` | Régua de cobrança, faturas vencidas |
| `faturas` | `status` | Painel de inadimplência |
| `recebiveis` | `dataPrevista` | Projeção de recebimento futuro |
| `recebiveis` | `origemCapitalId` | Visão do investidor por ativo |
| `origens_capital` | `contratoInvestimentoId` | Aportes de um contrato de investimento |
| `acordos` | `status` | Painel de acordos ativos |

### Índice composto recomendado

Para a régua de cobrança, que filtra faturas vencidas por período, considere após medir a performance:

```prisma
@@index([status, dataVencimento])
```

Adicionar somente se as queries de régua mostrarem lentidão — índices compostos têm custo de escrita.

---

## 10. Schema completo

O schema acima deve ser montado em um único arquivo `apps/backend/prisma/schema.prisma` na seguinte ordem:

1. Bloco `generator` e `datasource` (seção 2)
2. Todos os `enum` (seção 3)
3. Todos os `model` (seções 4 a 8)

Após montar, rodar:

```bash
pnpm db:migrate:dev --name init
```

Isso cria a primeira migration e aplica no banco local.

---

## 11. Notas de implementação

### 11.1 Filtro global de soft delete

Para não esquecer o `deletedAt: null` em cada query, usar Prisma Client Extensions:

```typescript
// src/database/prisma.service.ts
const softDeleteModels = [
  'Titular', 'Conta', 'ContratoCredito', 'ContratoInvestimento', 'Fatura',
  'Parcela', 'Acordo', 'Ativo', 'ItemContratado', 'Recebivel',
];
// aplicar extensão que injeta deletedAt: null em findMany/findFirst
// e converte delete em update { deletedAt: new Date() }
```

### 11.2 Cálculo de status de Parcela em runtime

Toda leitura de parcela passa por uma função que, se `status` for null, calcula o estado:

```typescript
function resolverStatusParcela(parcela: Parcela): string {
  if (parcela.status) return parcela.status; // estado real armazenado

  const hoje = startOfDay(new Date());
  const venc = startOfDay(parcela.dataVencimento);

  if (isSameDay(hoje, venc)) return 'Vence hoje';
  if (isAfter(hoje, venc))   return 'Vencida';
  return 'Em aberto';
}
```

Esta função vive em `@azit/utils` para ser compartilhada entre backend e frontend.

### 11.3 Geração do cronograma na originação

Quando um contrato chega via API, o sistema gera todas as parcelas e faturas futuras de uma vez. Esse é o maior insert do sistema — um contrato de 157 parcelas gera 157 parcelas + recebíveis + distribui em faturas. Usar `createMany` em transação para garantir atomicidade.

### 11.4 Precisão de taxas

`taxaRetorno` e `taxaDescontoQuitacao` usam `Decimal(8, 6)` — permite taxas como `0.001000` (0,1% ao dia) com precisão suficiente para o cálculo de valor presente.

### 11.5 Relacionamento Acordo ↔ Parcela (novação)

A renegociação segue o modelo bancário de **novação**: a obrigação antiga é extinta e substituída por uma nova. Isso se traduz em duas relações distintas e bem definidas entre Acordo e Parcela.

**Parcelas antigas (extintas pelo acordo).** São as parcelas vencidas que o operador selecionou. Recebem `status = RENEGOCIADA` e apontam para o acordo via `acordoId`, na relação nomeada `ParcelasRenegociadas`. Continuam existindo para auditoria, mas não são mais cobráveis.

**Parcelas novas (geradas pelo acordo).** Não se vinculam diretamente ao acordo. Em vez disso, o acordo gera um **ItemContratado novo** com `origem = RENEGOCIACAO`, e as parcelas novas pertencem a esse item — exatamente como qualquer outro produto da cesta. O acordo se vincula a esse item pela relação `ItemGeradoPorAcordo` (via `acordoOrigemId` no ItemContratado).

Isso traz três benefícios:

- O campo `itemContratadoId` em Parcela permanece **obrigatório** — toda parcela sempre tem um item de origem, sem exceção.
- A rastreabilidade é total: a partir do acordo chega-se às parcelas antigas (o que foi extinto) e ao item novo com suas parcelas (o que foi criado).
- O crédito de renegociação se comporta como qualquer outro item parcelado da cesta, reutilizando toda a lógica de geração de cronograma, faturamento e recebíveis. Nenhum caminho de código especial.

**Fluxo na efetivação do acordo** (status Rascunho → Ativo, após webhook da entrada):

1. Marcar as parcelas selecionadas como `RENEGOCIADA`, preenchendo `acordoId`
2. Criar um `ItemContratado` com `origem = RENEGOCIACAO` e `acordoOrigemId` apontando para o acordo
3. Gerar as novas parcelas vinculadas a esse item, com numeração própria (1/12, 2/12...)
4. As novas parcelas entram nas próximas faturas abertas pelo fluxo normal

O exemplo do banco que motivou esta modelagem: ao renegociar parcelas de um financiamento, o banco não altera as parcelas antigas — ele cria um novo crédito que as quita. A linha "Renegociação contrato nº X" no extrato é justamente esse ItemContratado de origem RENEGOCIACAO.

---

*Doc 5 — Prisma Schema · Azit Move V3 · v1.0 · jun/2025*
*Documentos relacionados: Doc 2 — Spec de Domínio · Doc 4 — Setup · Doc 6 — Autenticação (pendente)*
