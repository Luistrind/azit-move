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
import { InvestimentoService } from './investimento.service';
import {
  criarInvestimentoSchema,
  CriarInvestimentoDto,
  listarInvestimentosSchema,
  ListarInvestimentosDto,
} from './dto/investimento.dto';

@Controller()
export class InvestimentoController {
  constructor(private readonly investimento: InvestimentoService) {}

  // 8.1 — ContratoInvestimento (CRUD).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos-investimento')
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarInvestimentoSchema)) dto: CriarInvestimentoDto) {
    return this.investimento.criar(dto);
  }

  @Get('contratos-investimento')
  listar(
    @Query(new ZodValidationPipe(listarInvestimentosSchema)) filtros: ListarInvestimentosDto,
  ) {
    return this.investimento.listar(filtros);
  }

  @Get('contratos-investimento/:id')
  buscarPorId(@Param('id') id: string) {
    return this.investimento.buscarPorId(id);
  }

  @Get('titulares/:id/contratos-investimento')
  porTitular(@Param('id') id: string) {
    return this.investimento.porTitular(id);
  }

  // Visão consolidada da conta (os dois lados — banco digital).
  @Get('contas/:id/visao-geral')
  visaoGeral(@Param('id') id: string) {
    return this.investimento.visaoGeral(id);
  }
}
