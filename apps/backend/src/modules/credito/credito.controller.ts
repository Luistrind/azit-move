import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreditoService } from './credito.service';
import {
  originarCreditoSchema,
  OriginarCreditoDto,
  simularCreditoSchema,
  SimularCreditoDto,
  reprovarCreditoSchema,
  ReprovarCreditoDto,
} from './dto/credito.dto';

// Crédito de manutenção (crédito avulso para cliente já ativo) — Doc 2 §4.7-A.
@Controller()
export class CreditoController {
  constructor(private readonly credito: CreditoService) {}

  // Prévia da parcela (não persiste).
  @Post('creditos/simular')
  @HttpCode(200)
  simular(@Body(new ZodValidationPipe(simularCreditoSchema)) dto: SimularCreditoDto) {
    return this.credito.simular(dto);
  }

  // Operador origina o crédito para um titular existente → aguardando alçada.
  @Roles(RoleUsuario.OPERADOR, RoleUsuario.APROVADOR, RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('titulares/:id/creditos')
  @HttpCode(201)
  originar(
    @Param('id') titularId: string,
    @Body(new ZodValidationPipe(originarCreditoSchema)) dto: OriginarCreditoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.credito.originar(titularId, dto, user.id);
  }

  // Fila de aprovação.
  @Get('creditos/pendentes')
  pendentes() {
    return this.credito.pendentes();
  }

  // Aprovação pela alçada.
  @Roles(RoleUsuario.APROVADOR, RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('creditos/:id/aprovar')
  aprovar(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.credito.aprovar(id, user.id);
  }

  @Roles(RoleUsuario.APROVADOR, RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('creditos/:id/reprovar')
  reprovar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reprovarCreditoSchema)) dto: ReprovarCreditoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.credito.reprovar(id, user.id, dto);
  }
}
