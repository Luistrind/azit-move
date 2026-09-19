import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ReguaService } from './regua.service';

@Controller()
export class ReguaController {
  constructor(private readonly regua: ReguaService) {}

  // 5.6 — Kanban da régua.
  @Get('regua')
  listar() {
    return this.regua.listar();
  }

  // 5.4 — Bloqueio manual (Regra 6 / POP-COB-001): livre 24h após a 4ª
  // notificação; antes disso exige justificativa (risco concreto).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/bloquear')
  bloquear(@Param('id') id: string, @Body() body: { justificativa?: string } | undefined, @CurrentUser() user: UsuarioAutenticado) {
    return this.regua.bloquear(id, user.id, body?.justificativa);
  }

  // 5.5 — Desbloqueio manual.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/desbloquear')
  desbloquear(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.regua.desbloquear(id, user.id);
  }

  // Dev: roda a régua (varredura diária; as notificações do POP têm fila própria).
  // Em prod é job agendado na fila regua-step.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/varrer-regua')
  @HttpCode(200)
  varrer() {
    return this.regua.rodar();
  }
}
