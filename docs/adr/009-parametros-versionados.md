# ADR-009: Parâmetros versionados com snapshot congelado

- **Status:** Aceita
- **Data:** 2026-07-05
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Mudar um parâmetro de precificação não pode alterar contratos/simulações existentes (retroatividade).

**Decisão.** Configuração de simulador é versionada (nova configuração = nova versão); simulações e contratos gravam a versão usada e nunca são recalculados. Evolução planejada: central de parâmetros organizada por fluxo/produto (reunião 13/07).

**Consequências.** Rastreabilidade completa do preço de cada contrato; auditoria de mudanças com antes/depois.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
