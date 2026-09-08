import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { NotificacaoService } from './notificacao.service';

// Sino por USUÁRIO (doc 02 §16.1): a listagem e a leitura são individuais.
@Controller('notificacoes')
export class NotificacaoController {
  constructor(private readonly service: NotificacaoService) {}

  @Get()
  listar(@CurrentUser() user: UsuarioAutenticado) {
    return this.service.listar(user.id);
  }

  @Post(':id/lida')
  @HttpCode(200)
  marcarLida(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.service.marcarLida(id, user.id);
  }

  @Post('marcar-todas-lidas')
  @HttpCode(200)
  marcarTodas(@CurrentUser() user: UsuarioAutenticado) {
    return this.service.marcarTodasLidas(user.id);
  }
}
