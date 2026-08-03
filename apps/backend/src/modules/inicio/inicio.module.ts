import { Module } from '@nestjs/common';
import { InicioController } from './inicio.controller';

// Tela Início — fila de trabalho por papel (proposta UX §4.3).
@Module({
  controllers: [InicioController],
})
export class InicioModule {}
