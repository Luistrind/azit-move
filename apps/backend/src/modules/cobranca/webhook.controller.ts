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
    @InjectQueue(QUEUE_NAMES.EFETIVAR_ACORDO)
    private readonly filaAcordo: Queue,
    @InjectQueue(QUEUE_NAMES.ATIVAR_CONTRATO)
    private readonly filaAtivacao: Queue,
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

    // Sem payment/externalReference (eventos de teste ou cobranças fora do nosso
    // fluxo) → ACK 202 e ignora. Nunca devolver erro: o Asaas pausa a fila após falhas.
    const pg = dto.payment;
    const ref = pg?.externalReference;
    if (!pg || !ref) {
      return { received: true, ignored: true };
    }
    const recebido = dto.event === 'PAYMENT_RECEIVED' || dto.event === 'PAYMENT_CONFIRMED';

    // externalReference roteia por prefixo: "acordo:" = entrada de renegociação;
    // "ativacao:" = entrada do contrato (dia zero → cronograma); sem prefixo = fatura.
    if (recebido && ref.startsWith('acordo:')) {
      await this.filaAcordo.add('efetivar', {
        acordoId: ref.slice('acordo:'.length),
        paymentDate: pg.paymentDate ?? pg.dueDate ?? '',
      });
      return { received: true };
    }
    if (recebido && ref.startsWith('ativacao:')) {
      await this.filaAtivacao.add('ativar', {
        contratoId: ref.slice('ativacao:'.length),
        paymentDate: pg.paymentDate ?? pg.dueDate ?? '',
      });
      return { received: true };
    }

    const evento = {
      faturaId: ref,
      paymentDate: pg.paymentDate ?? pg.dueDate ?? '',
      dueDate: pg.dueDate ?? '',
      valor: Math.round((pg.value ?? 0) * 100), // Asaas envia reais → centavos
    };
    if (recebido) {
      await this.filaRecebido.add('conciliar', evento);
    } else if (dto.event === 'PAYMENT_OVERDUE') {
      await this.filaVencido.add('vencido', evento);
    }

    return { received: true };
  }
}
