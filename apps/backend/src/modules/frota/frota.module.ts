import { Module } from '@nestjs/common';
import { OcorrenciaService } from './ocorrencia.service';
import { InfleetService } from './infleet.service';
import { FrotaController } from './frota.controller';

// Controle de frota (doc 02 §25): ocorrências do veículo (multas, IPVA,
// licenciamento) com desfecho/repasse e o robô do Infleet. A LISTA da frota é
// a tela de Estoque de ativos (decisão Luís 20/09) — não há tela separada.
@Module({
  controllers: [FrotaController],
  providers: [OcorrenciaService, InfleetService],
  exports: [OcorrenciaService],
})
export class FrotaModule {}
