# ADR-002: Rebuild limpo a partir de documentação, sem código legado

- **Status:** Aceita
- **Data:** 2026-06
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** O sistema anterior (PopHub/implementações prévias) tinha decisões acopladas e stack heterogênea.

**Decisão.** Reconstruir a partir de `docs/` (design thinking → domínio → backlog), sem reintroduzir código legado. Dados legados entram por migração de dados, não de código.

**Consequências.** Domínio limpo e em português; o custo é reimplementar funcionalidades que já existiam.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
