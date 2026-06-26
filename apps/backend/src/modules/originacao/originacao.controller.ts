import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OriginacaoService } from './originacao.service';
import { originarSchema, OriginarDto } from './dto/originar.dto';

@Controller('contratos')
export class OriginacaoController {
  constructor(private readonly originacao: OriginacaoService) {}

  // 7.2 — Originação PopHub -> Azit (api-spec §2). Auth real do PopHub (API key/
  // assinatura) é a definir no contrato de integração; por ora, role interno.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('originar')
  @HttpCode(201)
  originar(@Body(new ZodValidationPipe(originarSchema)) dto: OriginarDto) {
    return this.originacao.originar(dto);
  }
}
