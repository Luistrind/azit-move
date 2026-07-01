import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TitularService } from './titular.service';
import { criarTitularSchema, CriarTitularDto } from './dto/criar-titular.dto';
import {
  atualizarTitularSchema,
  AtualizarTitularDto,
} from './dto/atualizar-titular.dto';
import {
  listarTitularesSchema,
  ListarTitularesDto,
} from './dto/listar-titulares.dto';

@Controller('titulares')
export class TitularController {
  constructor(private readonly titularService: TitularService) {}

  // Cadastro é operação de console (ADMIN/OPERADOR). Leituras: qualquer autenticado.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(
    @Body(new ZodValidationPipe(criarTitularSchema)) dto: CriarTitularDto,
  ) {
    return this.titularService.criar(dto);
  }

  @Get()
  listar(
    @Query(new ZodValidationPipe(listarTitularesSchema))
    filtros: ListarTitularesDto,
  ) {
    return this.titularService.listar(filtros);
  }

  // Busca por CPF/CNPJ exato (item 2.1). Declarada antes de :id para não colidir.
  @Get('buscar')
  async buscarPorDocumento(@Query('documento') documento?: string) {
    if (!documento) {
      throw new NotFoundException({
        erro: 'nao_encontrado',
        mensagem: 'Informe o parâmetro documento',
      });
    }
    const titular = await this.titularService.buscarPorDocumento(documento);
    if (!titular) {
      throw new NotFoundException({
        erro: 'nao_encontrado',
        mensagem: 'Titular não encontrado',
      });
    }
    return titular;
  }

  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.titularService.buscarPorId(id);
  }

  // Ficha completa (cadastro vivo + conta + contratos pendurados).
  @Get(':id/ficha')
  ficha(@Param('id') id: string) {
    return this.titularService.ficha(id);
  }

  // Detalhe completo (tela dedicada): dados pessoais + docs + resumo financeiro + contratos.
  @Get(':id/detalhe')
  detalhe(@Param('id') id: string) {
    return this.titularService.detalhe(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarTitularSchema))
    dto: AtualizarTitularDto,
  ) {
    return this.titularService.atualizar(id, dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id') id: string) {
    await this.titularService.remover(id);
  }
}
