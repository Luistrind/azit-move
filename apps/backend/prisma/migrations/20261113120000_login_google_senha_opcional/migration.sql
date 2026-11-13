-- Doc 06 v1.1 bloco 2 (13/11/2026): entrar com Google, senha opcional por usuário
-- e registro de acessos. Migração ADITIVA: usuários existentes continuam com o
-- hash que já têm e ficam com permiteSenha = false (o Admin liga para quem precisar;
-- no homolog o seed liga para os usuários de teste).

-- CreateEnum
CREATE TYPE "FormaAcesso" AS ENUM ('GOOGLE', 'SENHA', 'REFRESH');

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "senhaHash" DROP NOT NULL,
ADD COLUMN     "permiteSenha" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleSub" TEXT;

-- CreateTable
CREATE TABLE "acessos_usuario" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "emailTentado" TEXT,
    "forma" "FormaAcesso" NOT NULL,
    "sucesso" BOOLEAN NOT NULL,
    "motivo" TEXT,
    "ip" TEXT,
    "agente" TEXT,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acessos_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_googleSub_key" ON "usuarios"("googleSub");

-- CreateIndex
CREATE INDEX "acessos_usuario_usuarioId_em_idx" ON "acessos_usuario"("usuarioId", "em");

-- CreateIndex
CREATE INDEX "acessos_usuario_emailTentado_em_idx" ON "acessos_usuario"("emailTentado", "em");

-- AddForeignKey
ALTER TABLE "acessos_usuario" ADD CONSTRAINT "acessos_usuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
