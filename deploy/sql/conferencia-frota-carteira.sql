-- Conferência FROTA × CARTEIRA (doc 02 §25.7 e §27.10). SÓ LEITURA: nenhum UPDATE/DELETE.
-- Pergunta do Luís (24/11/2026): a Frota diz 69 veículos "Em contrato", a Carteira diz
-- 68 clientes ativos e ainda avisa "4 contas sem contrato ativo". O que explica a diferença?
--
-- Rodar no banco de PRODUÇÃO (do servidor):
--   git fetch origin && git show origin/fix/conferencia-frota-carteira:deploy/sql/conferencia-frota-carteira.sql \
--     | docker exec -i $(docker ps -qf name=azit_azit-db | head -1) psql -U azit -d azit -f -
--
-- O que cada tela conta (código da v1.12.0):
--   FROTA "Em contrato" = veículos (tipo VEICULO, não apagados) com o STATUS GRAVADO do ativo
--     = EM_CONTRATO. O ativo vira EM_CONTRATO quando o contrato é CRIADO (formalização, ainda
--     Aguardando assinatura) e só sai disso na transferência (Gatilho 9), rescisão (Recuperado),
--     sinistro (Sinistrado) ou cancelamento (Disponível). Quitação NÃO muda o ativo (Gatilho 8):
--     o carro quitado continua "Em contrato" até alguém registrar a transferência.
--   CARTEIRA "clientes ativos" = CONTAS (titular não apagado) com pelo menos um contrato em status
--     ATIVO — de qualquer tipo: veículo, Reembolso Parcelado, crédito avulso, termo.
--   CARTEIRA "contas sem contrato ativo" = contas que aparecem na grade (têm algum contrato não
--     apagado) mas nenhum ATIVO: tudo encerrado (quitado, rescindido, cancelado, novado) ou contrato
--     ainda em formalização.
\pset footer off

\echo
\echo '=== 0) Os números das telas, recalculados aqui (devem bater com 80 / 69 / 68 / 4) ==='
SELECT
  (SELECT COUNT(*) FROM ativos a WHERE a.tipo = 'VEICULO' AND a."deletedAt" IS NULL)                              AS frota_total,
  (SELECT COUNT(*) FROM ativos a WHERE a.tipo = 'VEICULO' AND a."deletedAt" IS NULL AND a.status = 'EM_CONTRATO')  AS frota_em_contrato,
  (SELECT COUNT(DISTINCT c."contaId") FROM contratos_credito c
     JOIN contas co ON co.id = c."contaId" JOIN titulares t ON t.id = co."titularId"
    WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO' AND t."deletedAt" IS NULL)                                  AS clientes_ativos,
  (SELECT COUNT(*) FROM contas co JOIN titulares t ON t.id = co."titularId"
    WHERE t."deletedAt" IS NULL
      AND EXISTS     (SELECT 1 FROM contratos_credito c WHERE c."contaId" = co.id AND c."deletedAt" IS NULL)
      AND NOT EXISTS (SELECT 1 FROM contratos_credito c WHERE c."contaId" = co.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO')) AS contas_sem_contrato_ativo,
  (SELECT COUNT(*) FROM contratos_credito c WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO')                    AS contratos_ativos;

\echo
\echo '=== 1) Os 69 veículos "Em contrato", por motivo (classe de cada um) ==='
\echo '    A = tem contrato ATIVO (é o que a tela promete: "com cliente ativo")'
\echo '    B = contrato ainda em formalização (Aguardando assinatura / pagamento da entrada / entrega)'
\echo '    C = contrato QUITADO e transferência ainda não registrada (Gatilho 8: certo pela regra, mas a tela não diz)'
\echo '    D = nenhum contrato vivo nem quitado — PRESO (defeito: deveria ter saído de Em contrato)'
WITH classe AS (
  SELECT a.id,
         CASE
           WHEN EXISTS (SELECT 1 FROM contratos_credito c WHERE c."ativoId" = a.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO') THEN 'A contrato ativo'
           WHEN EXISTS (SELECT 1 FROM contratos_credito c WHERE c."ativoId" = a.id AND c."deletedAt" IS NULL
                          AND c.status IN ('RASCUNHO','AGUARDANDO_ASSINATURA','AGUARDANDO_PAGAMENTO_INICIAL','AGUARDANDO_ENTREGA_VEICULO')) THEN 'B em formalização'
           WHEN EXISTS (SELECT 1 FROM contratos_credito c WHERE c."ativoId" = a.id AND c."deletedAt" IS NULL
                          AND c.status = 'ENCERRADO' AND c."motivoEncerramento" = 'QUITACAO' AND c."transferenciaEfetivadaEm" IS NULL) THEN 'C quitado sem transferência'
           ELSE 'D preso sem contrato vivo'
         END AS classe
  FROM ativos a
  WHERE a.tipo = 'VEICULO' AND a."deletedAt" IS NULL AND a.status = 'EM_CONTRATO'
)
SELECT classe, COUNT(*) AS veiculos FROM classe GROUP BY 1 ORDER BY 1;

\echo
\echo '=== 2) QUAIS são os "Em contrato" das classes B, C e D (os que não são cliente ativo pelo carro) ==='
WITH classe AS (
  SELECT a.id,
         CASE
           WHEN EXISTS (SELECT 1 FROM contratos_credito c WHERE c."ativoId" = a.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO') THEN 'A'
           WHEN EXISTS (SELECT 1 FROM contratos_credito c WHERE c."ativoId" = a.id AND c."deletedAt" IS NULL
                          AND c.status IN ('RASCUNHO','AGUARDANDO_ASSINATURA','AGUARDANDO_PAGAMENTO_INICIAL','AGUARDANDO_ENTREGA_VEICULO')) THEN 'B em formalização'
           WHEN EXISTS (SELECT 1 FROM contratos_credito c WHERE c."ativoId" = a.id AND c."deletedAt" IS NULL
                          AND c.status = 'ENCERRADO' AND c."motivoEncerramento" = 'QUITACAO' AND c."transferenciaEfetivadaEm" IS NULL) THEN 'C quitado sem transferência'
           ELSE 'D preso sem contrato vivo'
         END AS classe
  FROM ativos a
  WHERE a.tipo = 'VEICULO' AND a."deletedAt" IS NULL AND a.status = 'EM_CONTRATO'
)
SELECT k.classe, a.placa, a.descricao,
       (SELECT STRING_AGG(t.nome || ' · ' || c.numero || ' (' || c.status || COALESCE('/' || c."motivoEncerramento", '')
                          || COALESCE(', encerrado ' || to_char(c."dataEncerramento" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YY'), '')
                          || CASE WHEN c."deletedAt" IS NOT NULL THEN ', APAGADO' ELSE '' END || ')', ' + ' ORDER BY c."createdAt")
          FROM contratos_credito c JOIN contas co ON co.id = c."contaId" JOIN titulares t ON t.id = co."titularId"
         WHERE c."ativoId" = a.id) AS contratos_do_veiculo,
       to_char(a."updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YY HH24:MI') AS ativo_alterado_em
FROM classe k JOIN ativos a ON a.id = k.id
WHERE k.classe <> 'A'
ORDER BY k.classe, a.placa;

\echo
\echo '=== 3) O contrário: contrato ATIVO cujo veículo NÃO está "Em contrato" (inconsistência; esperado: nenhuma linha) ==='
SELECT t.nome, c.numero, a.placa, a.tipo, a.status AS status_do_ativo,
       CASE WHEN a."deletedAt" IS NOT NULL THEN 'ativo APAGADO' ELSE '' END AS obs
FROM contratos_credito c
JOIN ativos a    ON a.id = c."ativoId"
JOIN contas co   ON co.id = c."contaId"
JOIN titulares t ON t.id = co."titularId"
WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO' AND a.tipo = 'VEICULO'
  AND (a.status <> 'EM_CONTRATO' OR a."deletedAt" IS NOT NULL)
ORDER BY 1;

\echo
\echo '=== 4) Titulares com MAIS DE UM veículo em contrato ativo (cada um é 1 cliente e 2+ carros) ==='
SELECT t.nome, COUNT(DISTINCT c."ativoId") AS veiculos,
       STRING_AGG(a.placa || ' · ' || c.numero, ' + ' ORDER BY c.numero) AS carros
FROM contratos_credito c
JOIN ativos a    ON a.id = c."ativoId" AND a.tipo = 'VEICULO' AND a."deletedAt" IS NULL
JOIN contas co   ON co.id = c."contaId"
JOIN titulares t ON t.id = co."titularId" AND t."deletedAt" IS NULL
WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO'
GROUP BY t.nome, co.id
HAVING COUNT(DISTINCT c."ativoId") > 1
ORDER BY 1;

\echo
\echo '=== 5) Clientes ativos SEM veículo em contrato ativo (só Reembolso Parcelado, crédito avulso, termo...) ==='
\echo '    contam como cliente ativo na carteira e não aparecem na frota'
SELECT t.nome,
       STRING_AGG(c.numero || ' (' || COALESCE(a.tipo::text, 'sem ativo') || ')', ' + ' ORDER BY c.numero) AS contratos_ativos
FROM contas co
JOIN titulares t ON t.id = co."titularId" AND t."deletedAt" IS NULL
JOIN contratos_credito c ON c."contaId" = co.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO'
LEFT JOIN ativos a ON a.id = c."ativoId"
WHERE NOT EXISTS (
  SELECT 1 FROM contratos_credito v JOIN ativos av ON av.id = v."ativoId"
  WHERE v."contaId" = co.id AND v."deletedAt" IS NULL AND v.status = 'ATIVO' AND av.tipo = 'VEICULO' AND av."deletedAt" IS NULL)
GROUP BY t.nome, co.id
ORDER BY 1;

\echo
\echo '=== 6) A PONTE: de 69 "Em contrato" para 68 clientes ativos ==='
WITH em_contrato AS (
  SELECT a.id FROM ativos a WHERE a.tipo = 'VEICULO' AND a."deletedAt" IS NULL AND a.status = 'EM_CONTRATO'
), com_ativo AS (   -- classe A: veículo Em contrato com contrato ATIVO, e a conta dele
  SELECT DISTINCT a.id, c."contaId"
  FROM em_contrato a JOIN contratos_credito c ON c."ativoId" = a.id AND c."deletedAt" IS NULL AND c.status = 'ATIVO'
  JOIN contas co ON co.id = c."contaId" JOIN titulares t ON t.id = co."titularId" AND t."deletedAt" IS NULL
), ativas AS (
  SELECT DISTINCT c."contaId" FROM contratos_credito c
  JOIN contas co ON co.id = c."contaId" JOIN titulares t ON t.id = co."titularId"
  WHERE c."deletedAt" IS NULL AND c.status = 'ATIVO' AND t."deletedAt" IS NULL
)
SELECT
  (SELECT COUNT(*) FROM em_contrato)                                                       AS "1_frota_em_contrato",
  -(SELECT COUNT(*) FROM em_contrato) + (SELECT COUNT(DISTINCT id) FROM com_ativo)          AS "2_menos_sem_contrato_ativo_BCD",
  -(SELECT COUNT(DISTINCT id) FROM com_ativo) + (SELECT COUNT(DISTINCT "contaId") FROM com_ativo) AS "3_menos_carro_a_mais_do_mesmo_cliente",
  (SELECT COUNT(*) FROM ativas a WHERE NOT EXISTS (SELECT 1 FROM com_ativo x WHERE x."contaId" = a."contaId")) AS "4_mais_cliente_ativo_sem_carro_em_contrato",
  (SELECT COUNT(*) FROM ativas)                                                            AS "5_clientes_ativos_carteira";

\echo
\echo '=== 7) As "contas sem contrato ativo" da carteira — quem são e por quê ==='
SELECT t.nome,
       STRING_AGG(c.numero || ' (' || c.status || COALESCE('/' || c."motivoEncerramento", '')
                  || COALESCE(', encerrado ' || to_char(c."dataEncerramento" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YY'), '')
                  || COALESCE(', veículo ' || a.placa || ' ' || a.status, '') || ')', ' + ' ORDER BY c."createdAt") AS contratos,
       BOOL_OR(c."veiculoBloqueadoEm" IS NOT NULL) AS tem_carimbo_de_bloqueio,
       (SELECT COUNT(*) FROM faturas f WHERE f."contaId" = co.id AND f."deletedAt" IS NULL AND f.status IN ('ABERTA','FECHADA')) AS faturas_em_aberto
FROM contas co
JOIN titulares t ON t.id = co."titularId" AND t."deletedAt" IS NULL
JOIN contratos_credito c ON c."contaId" = co.id AND c."deletedAt" IS NULL
LEFT JOIN ativos a ON a.id = c."ativoId"
WHERE NOT EXISTS (SELECT 1 FROM contratos_credito x WHERE x."contaId" = co.id AND x."deletedAt" IS NULL AND x.status = 'ATIVO')
GROUP BY t.nome, co.id
ORDER BY 1;

\echo
\echo '=== 8) Carimbo de bloqueio em contrato ENCERRADO (a carteira lê o carimbo de TODOS os contratos da conta) ==='
\echo '    conta_tem_contrato_ativo = sim → a grade mostra a conta como Bloqueada pelo contrato antigo'
\echo '    conta_tem_contrato_ativo = não → entra no cartão "Bloqueadas", mas o filtro Bloqueada não a lista'
SELECT t.nome, c.numero, c."motivoEncerramento",
       to_char(c."veiculoBloqueadoEm" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YY') AS bloqueado_em,
       EXISTS (SELECT 1 FROM contratos_credito x WHERE x."contaId" = co.id AND x."deletedAt" IS NULL AND x.status = 'ATIVO') AS conta_tem_contrato_ativo,
       (SELECT STRING_AGG(x.numero || CASE WHEN x."veiculoBloqueadoEm" IS NOT NULL THEN ' (bloqueado)' ELSE '' END, ' + ')
          FROM contratos_credito x WHERE x."contaId" = co.id AND x."deletedAt" IS NULL AND x.status = 'ATIVO') AS contratos_ativos_da_conta
FROM contratos_credito c
JOIN contas co   ON co.id = c."contaId"
JOIN titulares t ON t.id = co."titularId" AND t."deletedAt" IS NULL
WHERE c."deletedAt" IS NULL AND c.status = 'ENCERRADO' AND c."veiculoBloqueadoEm" IS NOT NULL
ORDER BY 1;
