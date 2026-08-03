-- F4: referência congelada da versão do Catálogo no contrato (snapshot). Aditivo.
-- Contratos existentes ficam NULL = regras de quitação legadas preservadas.
ALTER TABLE "contratos_credito" ADD COLUMN "catalogoVersaoRef" TEXT;
