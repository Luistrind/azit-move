import { Module } from '@nestjs/common';
import { CreditoController } from './credito.controller';
import { CreditoService } from './credito.service';
import { AtivoModule } from '../ativo/ativo.module';
import { OrigemCapitalModule } from '../origem-capital/origem-capital.module';
import { ContratoModule } from '../contrato/contrato.module';

// Crédito de manutenção (Doc 2 §4.7-A). AlcadaService e AsaasService vêm de módulos globais.
@Module({
  imports: [AtivoModule, OrigemCapitalModule, ContratoModule],
  controllers: [CreditoController],
  providers: [CreditoService],
})
export class CreditoModule {}
