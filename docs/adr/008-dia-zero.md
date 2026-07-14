# ADR-008: Cronograma nasce no dia zero — o pagamento da entrada

- **Status:** Aceita
- **Data:** 2026-06-29
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** Contrato formalizado e não pago não é operação; gerar carteira na formalização criaria recebíveis de operações que podem nunca ativar.

**Decisão.** Formalização cria o contrato em "Aguardando assinatura" SEM cronograma. Assinaturas → cobrança da entrada → pagamento confirmado = dia zero: parcelas + recebíveis + faturas nascem completos. Legado/novação nascem ativos e geram cronograma na criação.

**Consequências.** Carteira contém apenas operações com dinheiro na mesa; dia zero é âncora inequívoca para juros, IPCA e agenda do investidor.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
