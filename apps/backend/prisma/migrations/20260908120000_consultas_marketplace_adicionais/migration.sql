-- Consultas adicionais do birô (Luís 08/09): Score Boa Vista e Score Positivo
-- (Marketplace, pagas) + distribuição de processos e processos detalhados
-- (Plataforma, franquia). Só ADD VALUE — nenhum uso na mesma transação.
ALTER TYPE "TipoConsultaExterna" ADD VALUE 'BOAVISTA_SCORE';
ALTER TYPE "TipoConsultaExterna" ADD VALUE 'SCORE_POSITIVO';
ALTER TYPE "TipoConsultaExterna" ADD VALUE 'DISTRIBUICAO_PROCESSOS';
ALTER TYPE "TipoConsultaExterna" ADD VALUE 'PROCESSOS';
