-- Conversas como atendimento (doc 02 §34.5): o lead nascido no WhatsApp pode ser registrado sem CPF
-- (o CPF continua obrigatório para simular).
ALTER TABLE "leads" ALTER COLUMN "cpf" DROP NOT NULL;
