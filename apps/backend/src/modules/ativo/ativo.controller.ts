import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AtivoService } from './ativo.service';
import { criarAtivoSchema, CriarAtivoDto } from './dto/criar-ativo.dto';
import { atualizarAtivoSchema, AtualizarAtivoDto } from './dto/atualizar-ativo.dto';
import { listarAtivosSchema, ListarAtivosDto } from './dto/listar-ativos.dto';

@Controller('ativos')
export class AtivoController {
  constructor(private readonly ativoService: AtivoService) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarAtivoSchema)) dto: CriarAtivoDto) {
    return this.ativoService.criar(dto);
  }

  @Get()
  listar(
    @Query(new ZodValidationPipe(listarAtivosSchema)) filtros: ListarAtivosDto,
  ) {
    return this.ativoService.listar(filtros);
  }

  // Busca por chassi ou placa exatos. Declarada antes de :id para não colidir.
  @Get('buscar')
  buscar(@Query('chassi') chassi?: string, @Query('placa') placa?: string) {
    return this.ativoService.buscarPorIdentificador({ chassi, placa });
  }

  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.ativoService.buscarPorId(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarAtivoSchema)) dto: AtualizarAtivoDto,
  ) {
    return this.ativoService.atualizar(id, dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id') id: string) {
    await this.ativoService.remover(id);
  }
}
