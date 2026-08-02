-- Gestão de usuários e permissões por área (doc 02 §16). Aditivo.
CREATE TYPE "AreaSistema" AS ENUM ('COMERCIAL','ANALISE_CADASTRO','CONTRATOS','CARTEIRA_COBRANCA','PESSOAS','ATIVOS_FROTA','CAPITAL_INVESTIMENTO','PRODUTOS','APROVACOES','CONFIGURACOES');

CREATE TABLE "permissoes_papel_area" (
    "id" TEXT NOT NULL,
    "papel" "RoleUsuario" NOT NULL,
    "area" "AreaSistema" NOT NULL,
    "permitido" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "permissoes_papel_area_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissoes_papel_area_papel_area_key" ON "permissoes_papel_area"("papel","area");

CREATE TABLE "permissoes_usuario_area" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "area" "AreaSistema" NOT NULL,
    "concedida" BOOLEAN NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissoes_usuario_area_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissoes_usuario_area_usuarioId_area_key" ON "permissoes_usuario_area"("usuarioId","area");
ALTER TABLE "permissoes_usuario_area" ADD CONSTRAINT "permissoes_usuario_area_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed da matriz padrão papel × área
INSERT INTO "permissoes_papel_area" ("id","papel","area","permitido","updatedAt")
SELECT 'ppa_' || p || '_' || a, p::"RoleUsuario", a::"AreaSistema", true, CURRENT_TIMESTAMP
FROM (VALUES
  ('ADMIN','COMERCIAL'),('ADMIN','ANALISE_CADASTRO'),('ADMIN','CONTRATOS'),('ADMIN','CARTEIRA_COBRANCA'),('ADMIN','PESSOAS'),('ADMIN','ATIVOS_FROTA'),('ADMIN','CAPITAL_INVESTIMENTO'),('ADMIN','PRODUTOS'),('ADMIN','APROVACOES'),('ADMIN','CONFIGURACOES'),
  ('DIRETOR','COMERCIAL'),('DIRETOR','ANALISE_CADASTRO'),('DIRETOR','CONTRATOS'),('DIRETOR','CARTEIRA_COBRANCA'),('DIRETOR','PESSOAS'),('DIRETOR','ATIVOS_FROTA'),('DIRETOR','CAPITAL_INVESTIMENTO'),('DIRETOR','PRODUTOS'),('DIRETOR','APROVACOES'),('DIRETOR','CONFIGURACOES'),
  ('APROVADOR','ANALISE_CADASTRO'),('APROVADOR','APROVACOES'),('APROVADOR','PESSOAS'),('APROVADOR','CARTEIRA_COBRANCA'),
  ('OPERADOR','COMERCIAL'),('OPERADOR','ANALISE_CADASTRO'),('OPERADOR','CONTRATOS'),('OPERADOR','CARTEIRA_COBRANCA'),('OPERADOR','PESSOAS'),('OPERADOR','ATIVOS_FROTA'),
  ('FINANCEIRO','CARTEIRA_COBRANCA'),('FINANCEIRO','PESSOAS'),('FINANCEIRO','ATIVOS_FROTA'),('FINANCEIRO','CAPITAL_INVESTIMENTO')
) AS m(p,a)
ON CONFLICT DO NOTHING;
