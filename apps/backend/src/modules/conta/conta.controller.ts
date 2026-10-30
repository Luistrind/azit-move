import {
  Body,
  Controller,
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
import { ContaService } from './conta.service';
import { CarteiraVisaoService } from './carteira-visao.service';
import {
  visaoPeriodoSchema,
  visaoMensalSchema,
  visaoClientesSchema,
  VisaoPeriodoQuery,
  VisaoMensalQuery,
  VisaoClientesQuery,
} from './dto/visao-carteira.dto';
import { criarContaSchema, CriarContaDto } from './dto/criar-conta.dto';
import {
  atualizarContaSchema,
  AtualizarContaDto,
} from './dto/atualizar-conta.dto';

@Controller('contas')
export class ContaController {
  constructor(
    private readonly contaService: ContaService,
    private readonly visaoService: CarteiraVisaoService,
  ) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarContaSchema)) dto: CriarContaDto) {
    return this.contaService.criar(dto);
  }

  // Carteira consolidada por titular/conta (declarada antes de :id para não colidir).
  @Get('carteira')
  carteira() {
    return this.contaService.carteira();
  }

  // Resumo da grade de clientes (doc 02 §27.8): valor sob gestão nominal e a
  // valor presente (a mesma conta da quitação antecipada, contrato a contrato).
  @Get('carteira/resumo')
  resumo() {
    return this.contaService.resumoCarteira();
  }

  // Visão da carteira por período (doc 02 §27): teto, recebidas, vencidas, a
  // vencer, por produto — uma agregação para todos os cartões da tela.
  @Get('carteira/visao')
  visao(@Query(new ZodValidationPipe(visaoPeriodoSchema)) q: VisaoPeriodoQuery) {
    return this.visaoService.visao(q.de, q.ate);
  }

  // Mês a mês (YYYY-MM inclusivos) — mesma agregação, uma por mês de vencimento.
  @Get('carteira/visao/mensal')
  visaoMensal(@Query(new ZodValidationPipe(visaoMensalSchema)) q: VisaoMensalQuery) {
    return this.visaoService.mensal(q.de, q.ate);
  }

  // Clientes atrás de um cartão (recebidas | vencidas | a_vencer) no período.
  @Get('carteira/visao/clientes')
  visaoClientes(@Query(new ZodValidationPipe(visaoClientesSchema)) q: VisaoClientesQuery) {
    return this.visaoService.clientes(q.de, q.ate, q.estado);
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
