import { Module } from '@nestjs/common';
import { CreditoController } from './credito.controller';
import { CreditoService } from './credito.service';
import { ContratoModule } from '../contrato/contrato.module';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { ContasPagarModule } from '../contas-pagar/contas-pagar.module';
import { AssinaturaModule } from '../assinatura/assinatura.module';

// Crédito de manutenção (Doc 2 §4.7-A). AlcadaService e AsaasService vêm de módulos globais.
@Module({
  imports: [ContratoModule, CatalogoModule, ContasPagarModule, AssinaturaModule],
  controllers: [CreditoController],
  providers: [CreditoService],
})
export class CreditoModule {}
