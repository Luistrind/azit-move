import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { QUEUE_NAMES } from '../queues/queues.module';
import { webhookAsaasSchema, WebhookAsaasDto } from './dto/webhook-asaas.dto';

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.PAGAMENTO_RECEBIDO)
    private readonly filaRecebido: Queue,
    @InjectQueue(QUEUE_NAMES.PAGAMENTO_VENCIDO)
    private readonly filaVencido: Queue,
  ) {}

  // Webhook nunca é síncrono (Regra nº 4): valida assinatura, responde 202 e
  // enfileira. Público (sem JWT) — autenticado pelo header asaas-access-token.
  @Public()
  @Post('asaas')
  @HttpCode(202)
  async asaas(
    @Headers('asaas-access-token') token: string | undefined,
    @Body(new ZodValidationPipe(webhookAsaasSchema)) dto: WebhookAsaasDto,
  ) {
    const segredo = this.config.get<string>('asaas.webhookSecret');
    // Em dev/simulado (sem segredo configurado) não exigimos o header.
    if (segredo && token !== segredo) {
      throw new UnauthorizedException({ erro: 'assinatura_invalida' });
    }

    const evento = {
      faturaId: dto.payment.externalReference,
      paymentDate: dto.payment.paymentDate ?? dto.payment.dueDate ?? '',
      dueDate: dto.payment.dueDate ?? '',
      valor: dto.payment.value ?? 0,
    };

    if (dto.event === 'PAYMENT_RECEIVED' || dto.event === 'PAYMENT_CONFIRMED') {
      await this.filaRecebido.add('conciliar', evento);
    } else if (dto.event === 'PAYMENT_OVERDUE') {
      await this.filaVencido.add('vencido', evento);
    }

    return { received: true };
  }
}
