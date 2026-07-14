# ADR-001: Monolito modular, não microserviços

- **Status:** Aceita (validada em reunião)
- **Data:** 2026-07-13
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Equipe enxuta (um desenvolvedor + IA) por tempo indeterminado; experiência do grupo com ecossistemas de microserviços (contexto bancário) mostra alto custo operacional. Vinícius defendia monolito desde o início; Cláudio revisou e concordou.

**Decisão.** Sistema único modular (NestJS com módulos por domínio), monorepo pnpm, fronteiras documentadas. Extração de serviços só mediante necessidade real e comprovada de escala.

**Consequências.** Menor complexidade operacional (um deploy, um banco); disciplina de fronteiras passa a ser responsabilidade da documentação e revisão, não da rede.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
