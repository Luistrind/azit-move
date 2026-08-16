import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { AssinaturaController } from './assinatura.controller';
import { AssinaturaService } from './assinatura.service';
import { AssinaturaProcessor } from './assinatura.processor';
import { ZapSignService } from './zapsign.service';

// Assinatura digital ZapSign F1 (doc 02 §21).
@Module({
  imports: [NotificacaoModule, BullModule.registerQueue({ name: QUEUE_NAMES.ASSINATURA_EVENTO })],
  controllers: [AssinaturaController],
  providers: [AssinaturaService, AssinaturaProcessor, ZapSignService],
  exports: [AssinaturaService],
})
export class AssinaturaModule {}
