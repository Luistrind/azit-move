-- Central de credenciais de integracao (decisao Luis 15/09): Asaas e ZapSign
-- configuraveis pela tela (write-only, mascarado), banco > env, sem redeploy.
CREATE TABLE "parametros_integracao" (
    "id" TEXT NOT NULL,
    "asaasAmbiente" TEXT NOT NULL DEFAULT 'sandbox',
    "asaasApiKey" TEXT,
    "asaasWebhookSecret" TEXT,
    "zapsignAmbiente" TEXT NOT NULL DEFAULT 'sandbox',
    "zapsignApiToken" TEXT,
    "zapsignWebhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parametros_integracao_pkey" PRIMARY KEY ("id")
);
