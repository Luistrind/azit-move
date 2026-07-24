import { Module } from '@nestjs/common';
import { CapitalController } from './capital.controller';

// Pessoas/classificações + camada de capital (doc 02 §15) — domínio 9 da taxonomia.
@Module({
  controllers: [CapitalController],
})
export class CapitalModule {}
