-- Conversas como atendimento (doc 02 §34.5): lead nascido no WhatsApp pode vir sem CPF
ALTER TABLE "leads" ALTER COLUMN "cpf" DROP NOT NULL;

-- Simulação feita para um número ainda sem lead guarda o número canônico da conversa
ALTER TABLE "simulacoes" ADD COLUMN "numeroWhatsapp" TEXT;
CREATE INDEX "simulacoes_numeroWhatsapp_idx" ON "simulacoes"("numeroWhatsapp");
