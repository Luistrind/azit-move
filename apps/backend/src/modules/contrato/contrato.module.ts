import { Module } from '@nestjs/common';
import { ContratoController } from './contrato.controller';
import { ContratoService } from './contrato.service';

// ContratoCredito + cronograma (Doc 2 §4.7, Doc 7 Bloco 3). Núcleo do negócio.
@Module({
  controllers: [ContratoController],
  providers: [ContratoService],
  exports: [ContratoService],
})
export class ContratoModule {}
