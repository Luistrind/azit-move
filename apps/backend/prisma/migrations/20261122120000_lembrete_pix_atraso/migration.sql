-- Doc 02 §28.6 (decisões Luís 22/11/2026): Pix copia e cola no lembrete D-2/D0
-- de quem tem uma fatura só e aviso de atraso no D+2. Aditiva.

-- Momento novo do lembrete e origem nova da intenção de pagamento.
ALTER TYPE "MomentoLembrete" ADD VALUE IF NOT EXISTS 'D_MAIS_2';
ALTER TYPE "OrigemIntencaoPagamento" ADD VALUE IF NOT EXISTS 'LEMBRETE';

-- Último dia em que a intenção vale. Para as existentes é o próprio dia em que
-- nasceram (a regra de antes: vale até 23h59 do dia).
ALTER TABLE "intencoes_pagamento" ADD COLUMN "ateDia" TEXT;
UPDATE "intencoes_pagamento" SET "ateDia" = "dia" WHERE "ateDia" IS NULL;
ALTER TABLE "intencoes_pagamento" ALTER COLUMN "ateDia" SET NOT NULL;
CREATE INDEX "intencoes_pagamento_contaId_ateDia_idx" ON "intencoes_pagamento"("contaId", "ateDia");

-- Lembrete que levou o Pix junto.
ALTER TABLE "lembretes_pagamento" ADD COLUMN "intencaoId" TEXT;

-- Parâmetros do WhatsApp: modelos novos e o Pix no lembrete. Nulos = padrão do
-- ambiente (lido no código), para não chumbar aqui o nome de produção no homolog.
ALTER TABLE "parametros_whatsapp" ADD COLUMN "modeloAtrasoNome" TEXT;
ALTER TABLE "parametros_whatsapp" ADD COLUMN "modeloAtrasoIdioma" TEXT;
ALTER TABLE "parametros_whatsapp" ADD COLUMN "modeloPixD2Nome" TEXT;
ALTER TABLE "parametros_whatsapp" ADD COLUMN "modeloPixD0Nome" TEXT;
ALTER TABLE "parametros_whatsapp" ADD COLUMN "modeloPixIdioma" TEXT;
ALTER TABLE "parametros_whatsapp" ADD COLUMN "pixNoLembrete" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "parametros_whatsapp" ADD COLUMN "recebedorPix" TEXT;
