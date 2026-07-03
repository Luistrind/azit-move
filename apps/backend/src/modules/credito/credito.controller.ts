import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
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
} from './dto/credito.dto';

// Crédito avulso para cliente já ativo (Doc 2 §4.7-A). A decisão acontece na
// Central de Aprovações (motor §7.9-A) — aqui só simulação e originação.
@Controller()
export class CreditoController {
  constructor(private readonly credito: CreditoService) {}

  // Prévia da parcela (não persiste).
  @Post('creditos/simular')
  @HttpCode(200)
  simular(@Body(new ZodValidationPipe(simularCreditoSchema)) dto: SimularCreditoDto) {
    return this.credito.simular(dto);
  }

  // Origina o crédito para um titular existente → solicitação no motor de aprovação.
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
}
