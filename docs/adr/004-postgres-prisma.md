# ADR-004: PostgreSQL 16 + Prisma

- **Status:** Aceita
- **Data:** 2026-06 (revalidada 2026-07-13)
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Alternativas de mercado (Oracle no contexto Banestes) têm alto custo; a equipe precisa de produtividade e portabilidade.

**Decisão.** PostgreSQL como banco único (fonte da verdade) com Prisma ORM; Decimal para dinheiro; migrations sempre aditivas.

**Consequências.** Custo zero de licença, ecossistema amplo; disciplina manual em consultas mais pesadas (índices, paginação).

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
