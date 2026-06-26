import { Module } from '@nestjs/common';
import { InvestimentoController } from './investimento.controller';
import { InvestimentoService } from './investimento.service';

// Bloco 8 (item 8.1) — ContratoInvestimento + visão consolidada da conta.
// Performance/breakdown do investidor e portal do titular ficam fora do V1
// (placeholder do fundo / fase futura — Doc 6 §8, Doc 3).
@Module({
  controllers: [InvestimentoController],
  providers: [InvestimentoService],
  exports: [InvestimentoService],
})
export class InvestimentoModule {}
