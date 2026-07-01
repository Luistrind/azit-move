import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ContratoService } from './contrato.service';
import { criarContratoSchema, CriarContratoDto } from './dto/criar-contrato.dto';
import {
  listarContratosSchema,
  ListarContratosDto,
} from './dto/listar-contratos.dto';

@Controller('contratos')
export class ContratoController {
  constructor(private readonly contratoService: ContratoService) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarContratoSchema)) dto: CriarContratoDto) {
    return this.contratoService.criar(dto);
  }

  @Get()
  listar(
    @Query(new ZodValidationPipe(listarContratosSchema)) filtros: ListarContratosDto,
  ) {
    return this.contratoService.listar(filtros);
  }

  // KPIs da Carteira. Declarado antes de :id para não colidir.
  @Get('kpis')
  kpis() {
    return this.contratoService.kpis();
  }

  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.contratoService.buscarPorId(id);
  }

  @Get(':id/cronograma')
  cronograma(@Param('id') id: string) {
    return this.contratoService.cronograma(id);
  }

  // Instrumento do contrato (texto) — para visualizar/baixar.
  @Get(':id/documento')
  documento(@Param('id') id: string) {
    return this.contratoService.documento(id);
  }
}
