import { Global, Module } from '@nestjs/common';
import { ParametrosService } from './parametros.service';
import { OfertaFixaService } from './oferta-fixa.service';
import { SimuladorController } from './simulador.controller';

// Configuração do simulador (Doc 2 §4-A.2). Global: SimulacaoService (funil) e
// CreditoService consomem os parâmetros vigentes.
@Global()
@Module({
  controllers: [SimuladorController],
  providers: [ParametrosService, OfertaFixaService],
  exports: [ParametrosService, OfertaFixaService],
})
export class SimuladorModule {}
