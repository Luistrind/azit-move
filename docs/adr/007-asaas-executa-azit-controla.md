# ADR-007: Asaas executa, Azit controla; webhook nunca síncrono

- **Status:** Aceita
- **Data:** 2026-06
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Terceirizar régua/lógica ao gateway de cobrança aprisionaria a regra de negócio fora do sistema.

**Decisão.** Toda lógica vive no Azit Hub; o Asaas apenas emite cobranças e notifica pagamentos. Webhooks respondem 202 e processam via fila (BullMQ) com retry.

**Consequências.** Conciliação automática desde o V1 (à frente do MVP planejado); trocar de gateway é substituir um executor, não reescrever regra.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
