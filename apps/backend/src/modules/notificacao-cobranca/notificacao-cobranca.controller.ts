import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RoleUsuario } from '@prisma/client';
// Tipos mínimos da resposta/requisição do Fastify (mesmo padrão do módulo de
// assinatura — o pacote 'fastify' não é dependência direta do backend).
type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer | string) => void };
type RequisicaoCrua = { rawBody?: Buffer };
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { QUEUE_NAMES } from '../queues/queues.module';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { NotificacaoCobrancaService } from './notificacao-cobranca.service';
import { WhatsappMetaService } from './whatsapp-meta.service';

const OPERACAO = [RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR];

function enviarPdf(res: Resposta, nome: string, buffer: Buffer, inline = true) {
  res.header('Content-Type', 'application/pdf');
  res.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${nome}"`);
  res.send(buffer);
}

// Notificações formais de cobrança — POP-COB-001 (doc 02 §23).
@Controller()
export class NotificacaoCobrancaController {
  constructor(private readonly service: NotificacaoCobrancaService) {}

  // ---- Parâmetros (Configurações > Notificações de cobrança) ----
  @Roles(...OPERACAO)
  @Get('notificacoes-cobranca/parametros')
  parametros() {
    return this.service.parametrosTela();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Put('notificacoes-cobranca/parametros')
  @HttpCode(200)
  salvar(@Body() body: Parameters<NotificacaoCobrancaService['salvarParametros']>[0], @CurrentUser() user: UsuarioAutenticado) {
    return this.service.salvarParametros(body ?? {}, user.id);
  }

  @Roles(...OPERACAO)
  @Post('notificacoes-cobranca/previa/:etapa')
  @HttpCode(200)
  async previa(@Param('etapa') etapa: string, @Body() body: { subtitulo?: string; assunto?: string; texto?: string }, @Res() res: Resposta) {
    const pdf = await this.service.previa(Number(etapa), body ?? {});
    enviarPdf(res, `previa-notificacao-${etapa}.pdf`, pdf);
  }

  // ---- Painel e dossiê do contrato ----
  @Get('contratos/:id/notificacoes-cobranca')
  painel(@Param('id') id: string) {
    return this.service.painelContrato(id);
  }

  @Get('contratos/:id/notificacoes-cobranca/dossie')
  async dossie(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado, @Res() res: Resposta) {
    const { nome, buffer } = await this.service.dossie(id, user.id);
    enviarPdf(res, nome, buffer, false);
  }

  @Get('notificacoes-cobranca/:id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Resposta) {
    const { nome, buffer } = await this.service.pdfDaNotificacao(id);
    enviarPdf(res, nome, buffer);
  }

  // ---- Ações do operador ----
  @Roles(...OPERACAO)
  @Post('notificacoes-cobranca/:id/reenviar')
  @HttpCode(200)
  reenviar(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.reenviar(id, user.id);
  }

  @Roles(...OPERACAO)
  @Post('contratos/:id/retomada')
  @HttpCode(200)
  retomada(
    @Param('id') id: string,
    @Body() body: { dataHora?: string; local: string; responsavel: string; condicoes: string; observacoes?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.registrarRetomada(id, body ?? ({} as never), user.id);
  }

  @Roles(...OPERACAO)
  @Post('contratos/:id/retomada/devolver')
  @HttpCode(200)
  devolver(@Param('id') id: string, @Body() body: { motivo: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.devolverVeiculo(id, body?.motivo, user.id);
  }

  // Jurídico e rescisão: decisão de direção (POP §16).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('contratos/:id/juridico')
  @HttpCode(200)
  juridico(@Param('id') id: string, @Body() body: { encaminhar: boolean; motivo?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.definirJuridico(id, !!body?.encaminhar, body?.motivo, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('contratos/:id/notificacoes-cobranca/rescisao')
  @HttpCode(200)
  rescisao(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.enviarRescisao(id, user.id);
  }

  // ---- Ferramentas de teste (homolog/dev) ----
  @Roles(...OPERACAO)
  @UseGuards(DevOnlyGuard)
  @Post('dev/notificacoes-cobranca/varrer')
  @HttpCode(200)
  varrerDev(@Body() body: { ignorarJanela?: boolean }) {
    return this.service.varrer({ ignorarJanela: body?.ignorarJanela ?? true });
  }

  @Roles(...OPERACAO)
  @UseGuards(DevOnlyGuard)
  @Post('dev/contratos/:id/notificacoes-cobranca/avancar')
  @HttpCode(200)
  avancar(@Param('id') id: string, @Body() body: { horas?: number }) {
    return this.service.avancarRelogio(id, Number(body?.horas ?? 24));
  }

  @Roles(...OPERACAO)
  @UseGuards(DevOnlyGuard)
  @Post('dev/notificacoes-cobranca/:id/simular-status')
  @HttpCode(200)
  simularStatus(@Param('id') id: string, @Body() body: { status: 'delivered' | 'read' }) {
    return this.service.simularStatus(id, body?.status === 'read' ? 'read' : 'delivered');
  }
}

// Webhook da Cloud API da Meta — público, autenticado pela assinatura HMAC
// (X-Hub-Signature-256 com o segredo do app). Regra 4: responde e enfileira.
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly meta: WhatsappMetaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.NOTIFICACAO_COBRANCA) private readonly fila: Queue,
  ) {}

  // Handshake de verificação ao cadastrar o webhook no painel da Meta.
  @Public()
  @Get()
  verificar(
    @Query('hub.mode') modo: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') desafio: string,
    @Res() res: Resposta,
  ) {
    const esperado = this.integracoes.whatsapp().verifyToken;
    if (modo !== 'subscribe' || !esperado || token !== esperado) throw new ForbiddenException();
    res.header('Content-Type', 'text/plain').send(desafio);
  }

  // A Meta exige 200 rápido; o processamento é na fila.
  @Public()
  @Post()
  @HttpCode(200)
  async receber(@Req() req: RequisicaoCrua, @Headers('x-hub-signature-256') assinatura: string | undefined, @Body() body: unknown) {
    const temSegredo = !!this.integracoes.whatsapp().appSecret;
    if (temSegredo) {
      if (!this.meta.assinaturaValida(req.rawBody, assinatura)) throw new UnauthorizedException();
    } else if (this.config.get<string>('ambiente') === 'producao') {
      throw new UnauthorizedException(); // produção nunca aceita webhook sem segredo
    }
    await this.fila.add('status-meta', body, { removeOnComplete: true, removeOnFail: 100 });
    return { recebido: true };
  }
}
