# ADR-010: Decimal para dinheiro; status calculados não são gravados

- **Status:** Aceita
- **Data:** 2026-06
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Float acumula erro em dinheiro; status derivados gravados dessincronizam do tempo (uma parcela "em aberto" vence sem ninguém tocá-la).

**Decisão.** Dinheiro: Decimal no banco, centavos inteiros na API. Status como "vencida"/"vence hoje" são calculados em runtime; só estados reais (paga, renegociada, bloqueado...) persistem.

**Consequências.** Nenhum job de "virada de status"; consultas por atraso computam sobre datas.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
