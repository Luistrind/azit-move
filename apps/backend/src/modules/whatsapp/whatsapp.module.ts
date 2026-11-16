import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { WhatsappMetaService } from './whatsapp-meta.service';
import { WhatsappParametrosService } from './whatsapp-parametros.service';
import { WhatsappEnvioService } from './whatsapp-envio.service';
import { WhatsappMensagensService } from './whatsapp-mensagens.service';
import { WhatsappEventosService } from './whatsapp-eventos.service';
import { WhatsappProcessor } from './whatsapp.processor';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappConfigController } from './whatsapp-config.controller';
import { LembreteService } from './lembrete.service';
import { LembreteController } from './lembrete.controller';

// WhatsApp enxuto (doc 02 §23, §24 e §28 — decisão Luís 15/11/2026): o canal
// (cliente da Meta, parâmetros versionados, regra única de envio, webhook e
// fila), os lembretes de pagamento e as Conversas. A notificação formal da POP
// fica fora (§23.5).
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.WHATSAPP })],
  controllers: [WhatsappWebhookController, WhatsappConfigController, LembreteController],
  providers: [
    WhatsappMetaService,
    WhatsappParametrosService,
    WhatsappEnvioService,
    WhatsappMensagensService,
    WhatsappEventosService,
    WhatsappProcessor,
    LembreteService,
  ],
  exports: [WhatsappEnvioService, WhatsappParametrosService, LembreteService],
})
export class WhatsappModule {}
