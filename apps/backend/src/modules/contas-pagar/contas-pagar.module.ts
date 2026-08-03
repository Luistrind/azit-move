import { Module } from '@nestjs/common';
import { AprovacaoModule } from '../aprovacao/aprovacao.module';
import { ContasPagarController } from './contas-pagar.controller';
import { ContasPagarService } from './contas-pagar.service';

// Contas a Pagar — Financeiro Administrativo / ERP Enxuto (doc 02 §18).
@Module({
  imports: [AprovacaoModule],
  controllers: [ContasPagarController],
  providers: [ContasPagarService],
  exports: [ContasPagarService],
})
export class ContasPagarModule {}
