import { Global, Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '../queues/queues.module';
import { EmailController } from './email.controller';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';
import { criarTransporteEmail, TRANSPORTE_EMAIL } from './transporte-email';

// E-mail genérico (doc 06 v1.1 §12.4). Global: a notificação dirigida usa hoje;
// a Fatura Azit (doc 02 §32) usa depois, pela mesma fila. O transporte é um
// provider por token — o teste troca pelo dublê sem tocar no resto.
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL })],
  controllers: [EmailController],
  providers: [
    EmailService,
    EmailProcessor,
    {
      provide: TRANSPORTE_EMAIL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => criarTransporteEmail(config, new Logger('TransporteEmail')),
    },
  ],
  exports: [EmailService, TRANSPORTE_EMAIL],
})
export class EmailModule {}
