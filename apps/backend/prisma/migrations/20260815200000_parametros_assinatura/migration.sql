-- Parametros da assinatura digital (doc 02 sec.21 F1.1): assinante Azit,
-- testemunhas padrao e envio automatico por WhatsApp. Linha unica criada
-- sob demanda pelo service (seed em codigo, idempotente).
CREATE TABLE "parametros_assinatura" (
    "id" TEXT NOT NULL,
    "azitNome" TEXT NOT NULL DEFAULT '',
    "azitCpf" TEXT NOT NULL DEFAULT '',
    "azitWhatsapp" TEXT NOT NULL DEFAULT '',
    "testemunha1Nome" TEXT NOT NULL DEFAULT '',
    "testemunha1Cpf" TEXT NOT NULL DEFAULT '',
    "testemunha1Whatsapp" TEXT NOT NULL DEFAULT '',
    "testemunha2Nome" TEXT NOT NULL DEFAULT '',
    "testemunha2Cpf" TEXT NOT NULL DEFAULT '',
    "testemunha2Whatsapp" TEXT NOT NULL DEFAULT '',
    "envioAutomaticoWhatsapp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_assinatura_pkey" PRIMARY KEY ("id")
);
