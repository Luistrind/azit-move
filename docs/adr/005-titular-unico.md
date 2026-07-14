# ADR-005: Titular é o cadastro único; papéis são derivados

- **Status:** Aceita
- **Data:** 2026-06 (validada 2026-07-13)
- **Decisores:** Luís (técnico) + Vicente/Cláudio (negócio), conforme registro no doc 02/CLAUDE.md

**Contexto.** A mesma pessoa pode ser cliente hoje e investidora amanhã. Cadastros separados por tipo (cliente/investidor/fornecedor) duplicariam o CPF e divergiriam com o tempo. Visão de longo prazo: relacionamento tipo banco digital.

**Decisão.** Cadastro único (Titular). Cliente e investidor são papéis calculados a partir do que a conta possui — não entidades nem tipos de login. Telas podem apresentar visões filtradas ("clientes", "investidores") sobre o mesmo dado.

**Consequências.** Ponto único de dados pessoais (LGPD); fornecedores/colaboradores, quando priorizados, entram como papéis/vínculos, não como cadastros paralelos.

> Origem: decisão já registrada na documentação viva (doc 02 / CLAUDE.md / atas de reunião); este arquivo formaliza o registro no padrão ADR (item 12 das "Definições Prévias").
