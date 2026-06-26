import { Global, Module } from '@nestjs/common';
import { AlcadaService } from './alcada.service';
import { AlcadaController } from './alcada.controller';

// AlcadaModule global — a verificação de alçada é transversal (renegociação,
// reajuste, despesas). Estrutura configurável (Doc 2 §7.9).
@Global()
@Module({
  controllers: [AlcadaController],
  providers: [AlcadaService],
  exports: [AlcadaService],
})
export class AlcadaModule {}
