# ADR-006: Cobrança conta-cêntrica: a fatura consolida todos os contratos

- **Status:** Aceita
- **Data:** 2026-07-03 (validada por Vicente em 2026-07-13)
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** O cliente não paga "contratos", paga uma fatura. Cobrança por contrato geraria N boletos e N negociações paralelas com a mesma pessoa, e permitiria atrasar um contrato mantendo outro em dia.

**Decisão.** A fatura é da Conta e agrega parcelas de todos os contratos do titular; parcela nova entra na próxima fatura ABERTA. Renegociação cobre a conta inteira ("paga tudo ou não paga nada"). Por baixo, cada parcela pertence ao seu contrato e cada recebível ao seu credor — visões por contrato/credor permanecem reconstruíveis.

**Consequências.** Uma cobrança, uma conversa de renegociação; regras de desconto na antecipação precisam ser por natureza do item somado na fatura (ver reunião 13/07).

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
