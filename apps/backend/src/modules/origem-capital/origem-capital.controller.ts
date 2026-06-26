import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OrigemCapitalService } from './origem-capital.service';
import {
  criarOrigemCapitalSchema,
  CriarOrigemCapitalDto,
} from './dto/criar-origem-capital.dto';
import {
  atualizarOrigemCapitalSchema,
  AtualizarOrigemCapitalDto,
} from './dto/atualizar-origem-capital.dto';

// Sub-recurso 1:1 do Ativo (Doc 2 §4.5).
@Controller('ativos/:ativoId/origem-capital')
export class OrigemCapitalController {
  constructor(private readonly service: OrigemCapitalService) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(
    @Param('ativoId') ativoId: string,
    @Body(new ZodValidationPipe(criarOrigemCapitalSchema))
    dto: CriarOrigemCapitalDto,
  ) {
    return this.service.criar(ativoId, dto);
  }

  @Get()
  buscar(@Param('ativoId') ativoId: string) {
    return this.service.buscarPorAtivo(ativoId);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch()
  atualizar(
    @Param('ativoId') ativoId: string,
    @Body(new ZodValidationPipe(atualizarOrigemCapitalSchema))
    dto: AtualizarOrigemCapitalDto,
  ) {
    return this.service.atualizar(ativoId, dto);
  }
}
