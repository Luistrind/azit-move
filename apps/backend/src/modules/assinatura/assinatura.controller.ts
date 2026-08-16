import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RoleUsuario } from '@prisma/client';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { QUEUE_NAMES } from '../queues/queues.module';
import { AssinaturaService } from './assinatura.service';

// Assinatura digital ZapSign F1 (doc 02 §21).
@Controller()
export class AssinaturaController {
  constructor(
    private readonly service: AssinaturaService,
    @InjectQueue(QUEUE_NAMES.ASSINATURA_EVENTO) private readonly fila: Queue,
  ) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Post('contratos/:id/assinatura-digital')
  @HttpCode(201)
  enviar(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.enviar(id, user.id);
  }

  @Get('contratos/:id/assinatura-digital')
  status(@Param('id') id: string) {
    return this.service.status(id);
  }

  @Get('contratos/:id/assinatura-digital/pdf')
  async pdf(@Param('id') id: string, @Res() res: { header: (k: string, v: string) => void; send: (b: Buffer) => void }) {
    const { nome, buffer } = await this.service.baixarPdfAssinado(id);
    res.header('Content-Type', 'application/pdf');
    res.header('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buffer);
  }

  // Webhook nunca é síncrono (Regra 4): valida o segredo próprio (G5 do
  // desenho), responde 202 e enfileira. Público — sem JWT.
  @Public()
  @Post('webhooks/zapsign')
  @HttpCode(202)
  async webhook(
    @Headers('x-azit-webhook-secret') segredo: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    const esperado = process.env.ZAPSIGN_WEBHOOK_SECRET;
    if (esperado && segredo !== esperado) {
      throw new UnauthorizedException({ erro: 'nao_autorizado', mensagem: 'Segredo do webhook inválido' });
    }
    await this.fila.add('evento', payload, {
      // Idempotência de reentrega: mesmo doc+evento+status não duplica job.
      jobId: `zs_${String(payload.token ?? payload.external_id ?? 'x')}_${String(payload.event_type ?? 'e')}_${Date.now()}`,
      removeOnComplete: true,
      removeOnFail: 50,
    });
    return { recebido: true };
  }

  // Dev: simula todos os signatários assinando (E2E sem credenciais ZapSign).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/simular-assinatura-digital/:id')
  @HttpCode(200)
  simular(@Param('id') id: string) {
    return this.service.simularAssinaturas(id);
  }
}
