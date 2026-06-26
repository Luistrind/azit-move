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
import { ContaService } from './conta.service';
import { criarContaSchema, CriarContaDto } from './dto/criar-conta.dto';
import {
  atualizarContaSchema,
  AtualizarContaDto,
} from './dto/atualizar-conta.dto';

@Controller('contas')
export class ContaController {
  constructor(private readonly contaService: ContaService) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarContaSchema)) dto: CriarContaDto) {
    return this.contaService.criar(dto);
  }

  // Conta de um titular (1:1). Declarada antes de :id para não colidir.
  @Get('por-titular/:titularId')
  buscarPorTitular(@Param('titularId') titularId: string) {
    return this.contaService.buscarPorTitular(titularId);
  }

  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.contaService.buscarPorId(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarContaSchema)) dto: AtualizarContaDto,
  ) {
    return this.contaService.atualizar(id, dto);
  }
}
