import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ReguaService } from './regua.service';
import { Area } from '../../common/decorators/area.decorator';

@Area(AreaSistema.CARTEIRA_COBRANCA)
@Controller()
export class ReguaController {
  constructor(private readonly regua: ReguaService) {}

  // 5.6 — Kanban da régua.
  @Get('regua')
  listar() {
    return this.regua.listar();
  }

  // 5.4 — Bloqueio do veículo (disponível a partir da raia "até 14 dias" — DIAS_BLOQUEIO_DISPONIVEL; registrado manualmente pelo operador).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/bloquear')
  bloquear(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.regua.bloquear(id, user.id);
  }

  // 5.5 — Desbloqueio manual.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/desbloquear')
  desbloquear(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.regua.desbloquear(id, user.id);
  }

  // Doc 02 §29.1 — recuperação do veículo (intervenção manual, a partir da raia "até 30 dias").
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/recuperacao')
  iniciarRecuperacao(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.regua.iniciarRecuperacao(id, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/recuperacao/encerrar')
  encerrarRecuperacao(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.regua.encerrarRecuperacao(id, user.id);
  }

  // Dev: roda a régua (varre inadimplência + dispara cobrança D+1/D+2).
  // Em prod é job agendado na fila regua-step.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/varrer-regua')
  @HttpCode(200)
  varrer() {
    return this.regua.rodar();
  }
}
