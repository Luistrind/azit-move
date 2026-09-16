-- Correcao 15/09: acordo_pagamento estava marcado como contratacao AVULSA e
-- aparecia DUPLICADO no modal "Novo produto" (o atalho fixo da triagem ja
-- desvia para o wizard da regua — decisao 09/09); o card do catalogo caia no
-- formulario generico de credito avulso, fluxo errado para acordo. Produtos
-- com fluxo proprio em tela dedicada (acordo, novacao) nao sao avulsos.
UPDATE "produtos_catalogo"
SET "contratacaoAvulsa" = false
WHERE chave IN ('acordo_pagamento', 'novacao')
  AND "contratacaoAvulsa" = true;
