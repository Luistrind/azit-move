import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { ConversaService } from './conversa.service';

type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer | string) => void };
const OPERACAO = [RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR];

// Conversas do WhatsApp (doc 02 §24, opção C): respostas dos clientes às
// notificações, atendidas no sistema.
@Roles(...OPERACAO)
@Controller()
export class ConversaController {
  constructor(private readonly service: ConversaService) {}

  @Get('conversas-whatsapp')
  listar() {
    return this.service.listar();
  }

  @Get('conversas-whatsapp/midia/:id')
  async midia(@Param('id') id: string, @Res() res: Resposta) {
    const { buffer, tipo, nome } = await this.service.arquivoMidia(id);
    res.header('Content-Type', tipo).header('Content-Disposition', `inline; filename="${nome}"`).send(buffer);
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

  // Ferramenta de teste (homolog): simula a resposta de um cliente.
  @UseGuards(DevOnlyGuard)
  @Post('dev/conversas-whatsapp/simular-entrada')
  @HttpCode(200)
  simularEntrada(@Body() body: { numero: string; texto: string }) {
    return this.service.simularEntrada(body?.numero, body?.texto);
  }
}
