import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReguaService } from './regua.service';

@Controller()
export class ReguaController {
  constructor(private readonly regua: ReguaService) {}

  // 5.6 — Kanban da régua.
  @Get('regua')
  listar() {
    return this.regua.listar();
  }

  // 5.4 — Bloqueio D+3 (regra absoluta, registrado manualmente pelo operador).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/bloquear')
  bloquear(@Param('id') id: string) {
    return this.regua.bloquear(id);
  }

  // 5.5 — Desbloqueio manual.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/desbloquear')
  desbloquear(@Param('id') id: string) {
    return this.regua.desbloquear(id);
  }

  // Dev: roda a régua (varre inadimplência + dispara cobrança D+1/D+2).
  // Em prod é job agendado na fila regua-step.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('dev/varrer-regua')
  @HttpCode(200)
  varrer() {
    return this.regua.rodar();
  }
}
