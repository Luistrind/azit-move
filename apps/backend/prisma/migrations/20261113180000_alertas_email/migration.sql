-- Alertas por e-mail (doc 06 v1.1 §12, bloco 3 — 13/11/2026). Aditiva.
-- Rastro do e-mail na própria notificação: quando saiu e, se não saiu, por quê.
ALTER TABLE "notificacoes" ADD COLUMN "emailEnviadoEm" TIMESTAMP(3);
ALTER TABLE "notificacoes" ADD COLUMN "emailFalha" TEXT;
