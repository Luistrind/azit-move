import { Module } from '@nestjs/common';
import { FrotaService } from './frota.service';
import { OcorrenciaService } from './ocorrencia.service';
import { InfleetService } from './infleet.service';
import { FrotaController } from './frota.controller';

// Controle de frota (doc 02 §25): situação operacional do veículo, ocorrências
// (multas, IPVA, licenciamento) com desfecho/repasse e o robô do Infleet.
@Module({
  controllers: [FrotaController],
  providers: [FrotaService, OcorrenciaService, InfleetService],
  exports: [FrotaService, OcorrenciaService],
})
export class FrotaModule {}
