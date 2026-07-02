-- Crédito de manutenção + Alçada configurável por papel (Doc 2 §4.7-A e §7.9, Decisão 2026-07-02).
-- Os enums "ModalidadeContrato" e "RoleUsuario" já existem. A tabela "alcadas" é config
-- placeholder (reSemeada) — dados embutidos aqui para que produção suba via migrate deploy
-- sem precisar rodar o seed inteiro (que limparia dados de teste).

-- 1) Modalidade do contrato: veículo = ASSINATURA (default); crédito de manutenção = COMPRA_PARCELADA.
ALTER TABLE "contratos_credito" ADD COLUMN "modalidade" "ModalidadeContrato" NOT NULL DEFAULT 'ASSINATURA';
-- Auditoria de aprovação (crédito de manutenção passa pela alçada — Doc 2 §4.7-A, §7.9).
ALTER TABLE "contratos_credito" ADD COLUMN "solicitadoPor" TEXT;
ALTER TABLE "contratos_credito" ADD COLUMN "aprovadoPor" TEXT;
ALTER TABLE "contratos_credito" ADD COLUMN "dataAprovacao" TIMESTAMP(3);

-- 2) Catálogo configurável de tipos de operação sujeitos a alçada.
CREATE TABLE "tipos_operacao_alcada" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipos_operacao_alcada_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tipos_operacao_alcada_chave_key" ON "tipos_operacao_alcada"("chave");

INSERT INTO "tipos_operacao_alcada" ("id","chave","nome","ativo","updatedAt") VALUES
 (gen_random_uuid()::text,'credito_avulso','Crédito avulso / manutenção',true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'acordo','Acordo (recuperação branda)',true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'novacao','Novação (recuperação radical)',true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'reajuste','Reajuste IPCA',true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'despesa','Financiamento de despesa',true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'venda','Venda de produto',true,CURRENT_TIMESTAMP);

-- 3) alcadas: de PER-USUÁRIO para PER-PAPEL. Tabela é placeholder → limpa antes de reestruturar.
DELETE FROM "alcadas";
ALTER TABLE "alcadas" DROP CONSTRAINT "alcadas_usuarioId_fkey";
DROP INDEX "alcadas_usuarioId_idx";
ALTER TABLE "alcadas" DROP COLUMN "usuarioId";
ALTER TABLE "alcadas" ALTER COLUMN "limiteMaximo" SET DEFAULT 0;
ALTER TABLE "alcadas" ADD COLUMN "papel" "RoleUsuario" NOT NULL;
ALTER TABLE "alcadas" ADD COLUMN "ilimitado" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "alcadas_papel_tipoOperacao_key" ON "alcadas"("papel", "tipoOperacao");
ALTER TABLE "alcadas" ADD CONSTRAINT "alcadas_tipoOperacao_fkey"
  FOREIGN KEY ("tipoOperacao") REFERENCES "tipos_operacao_alcada"("chave") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Matriz provisória (papel × operação → limite). ilimitado dispensa o teto. Valores = placeholder (Vicente).
INSERT INTO "alcadas" ("id","papel","tipoOperacao","limiteMaximo","ilimitado","ativo","updatedAt") VALUES
 -- ADMIN: super-usuário — ilimitado em tudo.
 (gen_random_uuid()::text,'ADMIN','credito_avulso',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'ADMIN','acordo',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'ADMIN','novacao',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'ADMIN','reajuste',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'ADMIN','despesa',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'ADMIN','venda',0,true,true,CURRENT_TIMESTAMP),
 -- DIRETOR: ilimitado em tudo.
 (gen_random_uuid()::text,'DIRETOR','credito_avulso',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'DIRETOR','acordo',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'DIRETOR','novacao',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'DIRETOR','reajuste',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'DIRETOR','despesa',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'DIRETOR','venda',0,true,true,CURRENT_TIMESTAMP),
 -- APROVADOR: tetos por operação.
 (gen_random_uuid()::text,'APROVADOR','credito_avulso',5000,false,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'APROVADOR','acordo',50000,false,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'APROVADOR','novacao',50000,false,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'APROVADOR','reajuste',0,true,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'APROVADOR','despesa',50000,false,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'APROVADOR','venda',50000,false,true,CURRENT_TIMESTAMP),
 -- OPERADOR: origina, aprova pouco (crédito avulso = 0 → não aprova, só origina).
 (gen_random_uuid()::text,'OPERADOR','credito_avulso',0,false,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'OPERADOR','acordo',20000,false,true,CURRENT_TIMESTAMP),
 (gen_random_uuid()::text,'OPERADOR','despesa',5000,false,true,CURRENT_TIMESTAMP);
