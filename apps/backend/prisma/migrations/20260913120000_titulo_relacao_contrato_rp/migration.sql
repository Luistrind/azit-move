-- Mão dupla do Reembolso Parcelado (doc 02 §18.5, 13/09): o vínculo título ↔
-- contrato vira relação formal (era id solto, sem FK).
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_contratoCreditoId_fkey"
  FOREIGN KEY ("contratoCreditoId") REFERENCES "contratos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
