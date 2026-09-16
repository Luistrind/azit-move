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
import { IntegracoesService } from '../integracoes/integracoes.service';

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly integracoes: IntegracoesService,
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
    // Segredo EFETIVO da central de integrações (banco > env — configurável
    // pela tela Configurações > Integrações, decisão 15/09).
    const segredo = this.integracoes.asaas().webhookSecret;
    // PRODUÇÃO EXIGE o segredo (auditoria 15/09, P0-1): sem ele o webhook
    // aceitaria payload anônimo — pagamento forjado. Em dev/simulado (fora de
    // produção, sem segredo configurado) não exigimos o header.
    if (!segredo && this.config.get<string>('nodeEnv') === 'production') {
      throw new UnauthorizedException({ erro: 'webhook_sem_segredo', mensagem: 'ASAAS_WEBHOOK_SECRET não configurado — webhook recusado em produção' });
    }
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
    // Entrada do acordo venceu sem pagamento → proposta EXPIRA (doc 02 §7.7,
    // 2026-08-18) — a cobrança já não aceita pagamento tardio.
    if (dto.event === 'PAYMENT_OVERDUE' && ref.startsWith('acordo:')) {
      await this.filaAcordo.add('entrada-vencida', { acordoId: ref.slice('acordo:'.length) });
      return { received: true };
    }
    // "novacao:" = recebimento inicial da novação (F2, 14/09): pagamento
    // dispara a ativação atômica; vencimento sem pagamento EXPIRA a proposta.
    if (recebido && ref.startsWith('novacao:')) {
      await this.filaAcordo.add('novacao-recebida', {
        novacaoId: ref.slice('novacao:'.length),
        paymentDate: pg.paymentDate ?? pg.dueDate ?? '',
      });
      return { received: true };
    }
    if (dto.event === 'PAYMENT_OVERDUE' && ref.startsWith('novacao:')) {
      await this.filaAcordo.add('novacao-recebimento-vencido', { novacaoId: ref.slice('novacao:'.length) });
      return { received: true };
    }
    if (recebido && ref.startsWith('ativacao:')) {
      await this.filaAtivacao.add('ativar', {
        contratoId: ref.slice('ativacao:'.length),
        paymentDate: pg.paymentDate ?? pg.dueDate ?? '',
      });
      return { received: true };
    }
    // Entrada do contrato venceu sem pagamento (auditoria 15/09, P0-3): antes
    // caía no else final e virava job de fatura com id inválido, que morria em
    // retry — o contrato ficava mudo em AGUARDANDO_PAGAMENTO_INICIAL. Agora a
    // carteira é alertada para reemitir ou cancelar (a expiração automática do
    // estado é decisão de domínio pendente — Bloco B da auditoria).
    if (dto.event === 'PAYMENT_OVERDUE' && ref.startsWith('ativacao:')) {
      await this.filaAtivacao.add('entrada-vencida', { contratoId: ref.slice('ativacao:'.length) });
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
