-- Motor F1 do Acordo de Pagamento (doc 02 sec.7.7, decisoes 2026-08-18):
-- proposta aceita cuja entrada vence sem pagamento EXPIRA (recalculo obrigatorio).
ALTER TYPE "StatusAcordo" ADD VALUE IF NOT EXISTS 'EXPIRADO';
