# ADR-012: Placeholder é funcional, nunca buraco

- **Status:** Aceita
- **Data:** 2026-06
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Várias regras dependem de definição de negócio (política de crédito, breakdown do recebível, alçadas definitivas). Esperar cada definição pararia a esteira.

**Decisão.** Toda regra "a definir" tem padrão provisório que roda, é testável, isolado e marcado como substituível. O sistema simula de ponta a ponta mesmo sem a regra final. Construção SOBRE um placeholder exige validação humana.

**Consequências.** Progresso contínuo; risco controlado de regra provisória ir a produção — mitigado pela marcação e pelas validações por marco.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
