import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { AreaSistema } from '@prisma/client';
import { Area } from '../../common/decorators/area.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { ConversaService } from './conversa.service';

// Resposta crua do Fastify (o pacote 'fastify' não é dependência direta do backend).
type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer) => void };

// Conversas do WhatsApp (doc 02 §24): respostas dos clientes, atendidas no
// sistema por quem tem a área Carteira e cobrança.
@Area(AreaSistema.CARTEIRA_COBRANCA)
@Controller()
export class ConversaController {
  constructor(private readonly service: ConversaService) {}

  @Get('conversas-whatsapp')
  listar() {
    return this.service.listar();
  }

  // Antes de `:numero` — rota fixa não pode ser engolida pelo parâmetro.
  @Get('conversas-whatsapp/midia/:id')
  async midia(@Param('id') id: string, @Res() res: Resposta) {
    const { buffer, tipo, nome } = await this.service.arquivoMidia(id);
    res.header('Content-Type', tipo).header('Content-Disposition', `inline; filename="${encodeURIComponent(nome)}"`).send(buffer);
  }

  @Get('conversas-whatsapp/:numero')
  conversa(@Param('numero') numero: string) {
    return this.service.conversa(numero);
  }

  @Post('conversas-whatsapp/:numero/lida')
  @HttpCode(200)
  lida(@Param('numero') numero: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.marcarLida(numero, user.id);
  }

  @Post('conversas-whatsapp/:numero/responder')
  @HttpCode(200)
  responder(@Param('numero') numero: string, @Body() body: { texto: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.responder(numero, body?.texto, user.id);
  }

  // Ferramenta de teste (homologação e desenvolvimento): simula a mensagem de um cliente.
  @UseGuards(DevOnlyGuard)
  @Post('dev/conversas-whatsapp/simular-entrada')
  @HttpCode(200)
  simularEntrada(@Body() body: { numero: string; texto: string }) {
    return this.service.simularEntrada(body?.numero, body?.texto);
  }
}
