import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AreaSistema } from '@prisma/client';
import { Area, AREAS_FICHA_TITULAR } from '../../common/decorators/area.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { LembreteService } from './lembrete.service';

// Lembretes de pagamento pelo WhatsApp (doc 02 §28).
// Leitura na ficha do titular: compartilhada com quem abre a ficha. Ligar,
// desligar e mexer no aviso do Asaas são atos da cobrança (área Carteira e
// cobrança) — na ficha, quem não tem a área só vê o estado.
@Area(AreaSistema.CARTEIRA_COBRANCA)
@Controller()
export class LembreteController {
  constructor(private readonly service: LembreteService) {}

  @Area(AreaSistema.CARTEIRA_COBRANCA, ...AREAS_FICHA_TITULAR)
  @Get('titulares/:id/lembretes')
  doTitular(@Param('id') id: string) {
    return this.service.doTitular(id);
  }

  @Post('titulares/:id/lembretes/ligar')
  @HttpCode(200)
  ligar(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.ligar(id, user.id);
  }

  @Post('titulares/:id/lembretes/desligar')
  @HttpCode(200)
  desligar(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.desligar(id, user.id);
  }

  // Altera o cadastro do cliente NO ASAAS (notificationDisabled) — ato explícito.
  @Post('titulares/:id/lembretes/aviso-asaas')
  @HttpCode(200)
  avisoAsaas(@Param('id') id: string, @Body() body: { desligado: boolean }, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.definirAvisoAsaas(id, body?.desligado === true, user.id);
  }

  // Visão geral para Configuração › WhatsApp: o que saiu hoje e o que está retido.
  @Area(AreaSistema.CONFIGURACOES, AreaSistema.CARTEIRA_COBRANCA)
  @Get('whatsapp/lembretes/resumo')
  resumo() {
    return this.service.resumo();
  }

  // ---- Ferramentas de teste (homologação e desenvolvimento) ----

  // Roda a varredura agora, ignorando a janela das 9h às 20h. A regra de envio
  // continua valendo: fora de produção só sai de verdade para número autorizado.
  @Area(AreaSistema.CONFIGURACOES, AreaSistema.CARTEIRA_COBRANCA)
  @UseGuards(DevOnlyGuard)
  @Post('dev/whatsapp/lembretes/varrer')
  @HttpCode(200)
  varrerDev() {
    return this.service.varrer({ ignorarJanela: true });
  }

  @Area(AreaSistema.CARTEIRA_COBRANCA, ...AREAS_FICHA_TITULAR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/whatsapp/lembretes/:id/simular-status')
  @HttpCode(200)
  simularStatus(@Param('id') id: string, @Body() body: { status: string }) {
    const status = body?.status === 'read' ? 'read' : body?.status === 'failed' ? 'failed' : 'delivered';
    return this.service.simularStatus(id, status);
  }
}
