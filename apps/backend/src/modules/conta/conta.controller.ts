import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ContaService } from './conta.service';
import { CarteiraVisaoService } from './carteira-visao.service';
import { FotoCarteiraService } from './foto-carteira.service';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { dataHojeBrasil } from '@azit/utils';
import {
  visaoPeriodoSchema,
  visaoMensalSchema,
  visaoClientesSchema,
  visaoVariacaoSchema,
  fotoCarteiraSchema,
  FotoCarteiraQuery,
  VisaoVariacaoQuery,
  VisaoPeriodoQuery,
  VisaoMensalQuery,
  VisaoClientesQuery,
} from './dto/visao-carteira.dto';
import { criarContaSchema, CriarContaDto } from './dto/criar-conta.dto';
import {
  atualizarContaSchema,
  AtualizarContaDto,
} from './dto/atualizar-conta.dto';
import { Area, AREAS_FICHA_TITULAR } from '../../common/decorators/area.decorator';

@Area(AreaSistema.CARTEIRA_COBRANCA)
@Controller('contas')
export class ContaController {
  constructor(
    private readonly contaService: ContaService,
    private readonly visaoService: CarteiraVisaoService,
    private readonly fotoService: FotoCarteiraService,
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

  // Primeiro e último mês com fatura — limites do gráfico e das setas do período.
  @Get('carteira/visao/limites')
  visaoLimites() {
    return this.visaoService.limites();
  }

  // Por que o teto muda de um mês para o outro (YYYY-MM): calendário, quem
  // entrou, quem saiu, fatura a mais/menos e valor que mudou — com os nomes.
  @Get('carteira/visao/variacao')
  visaoVariacao(@Query(new ZodValidationPipe(visaoVariacaoSchema)) q: VisaoVariacaoQuery) {
    return this.visaoService.variacao(q.de, q.para);
  }

  // Clientes atrás de um cartão (recebidas | vencidas | a_vencer) no período.
  @Get('carteira/visao/clientes')
  visaoClientes(@Query(new ZodValidationPipe(visaoClientesSchema)) q: VisaoClientesQuery) {
    return this.visaoService.clientes(q.de, q.ate, q.estado);
  }

  // Foto do início do mês (doc 02 §27.12): início × agora e a ponte do que mudou.
  // { mes, foto: null } enquanto o mês não tem foto (novembro/2026 nunca terá).
  @Get('carteira/foto')
  fotoDoMes(@Query(new ZodValidationPipe(fotoCarteiraSchema)) q: FotoCarteiraQuery) {
    return this.fotoService.comparar(q.mes);
  }

  // Só fora de produção: tira (ou refaz) agora a foto do mês corrente, para
  // homologar sem esperar o dia 1.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @UseGuards(DevOnlyGuard)
  @Post('carteira/foto/teste')
  @HttpCode(200)
  tirarFotoTeste() {
    return this.fotoService.tirarFoto(dataHojeBrasil().slice(0, 7), { refazer: true });
  }

  // Conta de um titular (1:1). Declarada antes de :id para não colidir.
  @Area(AreaSistema.CARTEIRA_COBRANCA, ...AREAS_FICHA_TITULAR)
  @Get('por-titular/:titularId')
  buscarPorTitular(@Param('titularId') titularId: string) {
    return this.contaService.buscarPorTitular(titularId);
  }

  @Area(AreaSistema.CARTEIRA_COBRANCA, ...AREAS_FICHA_TITULAR)
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
