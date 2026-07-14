# ADR-003: Frontend em React + Vite (SPA), não Next.js

- **Status:** Aceita
- **Data:** 2026-06 (revalidada 2026-07-13)
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Implementação anterior usava Next; o sistema é 100% autenticado (não há SEO/SSR a ganhar) e a zona de domínio técnico da equipe é React puro.

**Decisão.** SPA React + Vite, roteamento client-side, tudo atrás de login.

**Consequências.** Build e modelo mental mais simples; sem SSR (irrelevante para console interno).

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
