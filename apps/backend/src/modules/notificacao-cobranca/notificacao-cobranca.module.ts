import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { NotificacaoCobrancaService } from './notificacao-cobranca.service';
import { NotificacaoCobrancaProcessor } from './notificacao-cobranca.processor';
import { NotificacaoCobrancaController, WhatsappWebhookController } from './notificacao-cobranca.controller';
import { WhatsappMetaService } from './whatsapp-meta.service';

// Notificações formais de cobrança — POP-COB-001 (doc 02 §23). Consumido pela
// régua (estado POP do card + trava do bloqueio, Regra 6).
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICACAO_COBRANCA })],
  controllers: [NotificacaoCobrancaController, WhatsappWebhookController],
  providers: [NotificacaoCobrancaService, NotificacaoCobrancaProcessor, WhatsappMetaService],
  exports: [NotificacaoCobrancaService],
})
export class NotificacaoCobrancaModule {}
