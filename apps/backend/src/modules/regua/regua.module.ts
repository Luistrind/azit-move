import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { ReguaService } from './regua.service';
import { ReguaController } from './regua.controller';
import { ReguaStepProcessor } from './regua.processor';

// Bloco 5 — Régua de cobrança. Estágio é posição operacional calculada (não status).
// Usa FaturaService (CobrancaModule) para marcar inadimplência.
@Module({
  imports: [
    CobrancaModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.REGUA_STEP },
      { name: QUEUE_NAMES.NOTIFICAR_CLIENTE },
    ),
  ],
  controllers: [ReguaController],
  providers: [ReguaService, ReguaStepProcessor],
  exports: [ReguaService],
})
export class ReguaModule {}
