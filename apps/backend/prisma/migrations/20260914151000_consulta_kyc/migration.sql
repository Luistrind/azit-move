-- Consulta KYC (PEP/sancoes/obito) na 2a camada da analise (14/09) — insumo
-- do topico KYC do relatorio do assistente de analise.
ALTER TYPE "TipoConsultaExterna" ADD VALUE IF NOT EXISTS 'KYC';
