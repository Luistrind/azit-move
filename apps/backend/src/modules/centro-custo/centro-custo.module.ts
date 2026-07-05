import { Module } from '@nestjs/common';
import { CentroCustoService } from './centro-custo.service';
import { CentroCustoController } from './centro-custo.controller';

// Centro de custo do ativo (Doc 2 §4.4-A).
@Module({
  controllers: [CentroCustoController],
  providers: [CentroCustoService],
})
export class CentroCustoModule {}
