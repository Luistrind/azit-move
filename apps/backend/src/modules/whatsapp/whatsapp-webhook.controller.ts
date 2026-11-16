import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Logger, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Public } from '../../common/decorators/public.decorator';
import { QUEUE_NAMES } from '../queues/queues.module';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { WhatsappMetaService } from './whatsapp-meta.service';
import { JOB_EVENTO_META } from './whatsapp.processor';

// Tipos mínimos do Fastify (o pacote 'fastify' não é dependência direta do backend).
type Resposta = { header: (k: string, v: string) => Resposta; send: (b: string) => void };
type RequisicaoCrua = { rawBody?: Buffer };

// Webhook da Cloud API da Meta (doc 02 §23.4) — público, autenticado pela
// assinatura HMAC (X-Hub-Signature-256 com o segredo do aplicativo).
// Regra 4: responde na hora e enfileira; nada é processado na requisição.
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly meta: WhatsappMetaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.WHATSAPP) private readonly fila: Queue,
  ) {}

  // Cadastro do webhook no painel da Meta: ela chama por GET com o token de
  // verificação e espera o "desafio" de volta, em texto puro.
  @Public()
  @Get()
  verificar(
    @Query('hub.mode') modo: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') desafio: string | undefined,
    @Res() res: Resposta,
  ) {
    const esperado = this.integracoes.whatsapp().verifyToken;
    if (modo !== 'subscribe' || !esperado || token !== esperado) throw new ForbiddenException();
    res.header('Content-Type', 'text/plain').send(desafio ?? '');
  }

  // A Meta exige resposta rápida e reenvia em caso de erro: confere a
  // assinatura, enfileira e responde 200.
  @Public()
  @Post()
  @HttpCode(200)
  async receber(@Req() req: RequisicaoCrua, @Headers('x-hub-signature-256') assinatura: string | undefined, @Body() body: unknown) {
    const temSegredo = !!this.integracoes.whatsapp().appSecret;
    if (temSegredo) {
      if (!this.meta.assinaturaValida(req.rawBody, assinatura)) throw new UnauthorizedException({ erro: 'assinatura_invalida' });
    } else if (this.config.get<string>('ambiente') === 'producao') {
      // Produção nunca aceita webhook sem segredo (auditoria 15/09, P0-1).
      throw new UnauthorizedException({ erro: 'webhook_sem_segredo', mensagem: 'Segredo do aplicativo da Meta não configurado — webhook recusado em produção' });
    } else {
      this.logger.warn('webhook da Meta aceito SEM conferir assinatura (ambiente de teste sem segredo do aplicativo)');
    }
    await this.fila.add(JOB_EVENTO_META, body ?? {}, { removeOnComplete: true, removeOnFail: 100 });
    return { recebido: true };
  }
}
