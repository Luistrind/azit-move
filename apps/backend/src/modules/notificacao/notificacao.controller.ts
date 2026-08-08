import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { NotificacaoService } from './notificacao.service';

// Autenticação vem do guard global (JWT) — mesmo padrão dos demais controllers.
@Controller('notificacoes')
export class NotificacaoController {
  constructor(private readonly service: NotificacaoService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post(':id/lida')
  @HttpCode(200)
  marcarLida(@Param('id') id: string) {
    return this.service.marcarLida(id);
  }

  @Post('marcar-todas-lidas')
  @HttpCode(200)
  marcarTodas() {
    return this.service.marcarTodasLidas();
  }
}
