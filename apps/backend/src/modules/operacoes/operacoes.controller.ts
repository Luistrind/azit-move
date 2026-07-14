import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { QUEUE_NAMES } from '../queues/queues.module';
import { RenegociacaoService } from './renegociacao.service';
import { NovacaoService } from './novacao.service';
import { QuitacaoService } from './quitacao.service';
import { SinistroService } from './sinistro.service';
import { ReajusteService } from './reajuste.service';
import { novacaoSchema, NovacaoBody } from './dto/novacao.dto';
import {
  criarRenegociacaoSchema,
  CriarRenegociacaoBody,
  quitacaoSchema,
  QuitacaoBody,
  sinistroSchema,
  SinistroBody,
  reajusteSchema,
  ReajusteBody,
} from './dto/operacoes.dto';

@Controller()
export class OperacoesController {
  constructor(
    private readonly renegociacao: RenegociacaoService,
    private readonly novacao: NovacaoService,
    private readonly quitacao: QuitacaoService,
    private readonly sinistro: SinistroService,
    private readonly reajuste: ReajusteService,
    @InjectQueue(QUEUE_NAMES.EFETIVAR_ACORDO) private readonly filaAcordo: Queue,
  ) {}

  // --- Renegociação (6.2–6.5) — CONTA-cêntrica (Doc 2 §7.7): a inadimplência é da
  // conta; o acordo cobre as parcelas em atraso de todos os contratos do titular.
  @Get('contas/:id/renegociacao/elegivel')
  elegivelConta(@Param('id') id: string) {
    return this.renegociacao.elegiveisConta(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.APROVADOR, RoleUsuario.DIRETOR)
  @Post('contas/:id/renegociacao')
  @HttpCode(201)
  criarRenegociacao(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(criarRenegociacaoSchema)) dto: CriarRenegociacaoBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.renegociacao.criarPorConta(id, dto, user.id);
  }

  @Get('acordos')
  acordos() {
    return this.renegociacao.listar();
  }

  // Dev: simula o pagamento da entrada (enfileira efetivação, como o webhook).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.APROVADOR, RoleUsuario.DIRETOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/simular-entrada-acordo/:acordoId')
  @HttpCode(202)
  async simularEntrada(@Param('acordoId') acordoId: string) {
    await this.filaAcordo.add('efetivar', {
      acordoId,
      paymentDate: new Date().toISOString().slice(0, 10),
    });
    return { enfileirado: true, acordoId };
  }

  // --- Novação (6.6) — recuperação radical ---
  @Get('novacoes')
  novacoes() {
    return this.novacao.listar();
  }

  // Propõe a novação — a execução acontece na aprovação (motor §7.9-A, 2 aprovações).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.APROVADOR, RoleUsuario.DIRETOR)
  @Post('contratos/:id/novacao')
  @HttpCode(201)
  novar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(novacaoSchema)) dto: NovacaoBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.novacao.solicitar(id, dto, user.id);
  }

  // --- Quitação antecipada (6.7) ---
  @Post('contratos/:id/quitacao/simular')
  @HttpCode(200)
  simularQuitacao(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(quitacaoSchema)) dto: QuitacaoBody,
  ) {
    return this.quitacao.simular(id, dto.parcelaIds);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/quitacao')
  @HttpCode(200)
  quitar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(quitacaoSchema)) dto: QuitacaoBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.quitacao.quitar(id, dto.parcelaIds, user.id);
  }

  // --- Sinistro (6.7) ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/sinistro')
  @HttpCode(200)
  registrarSinistro(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sinistroSchema)) dto: SinistroBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.sinistro.registrar(id, dto.valorIndenizacao, user.id);
  }

  // --- Reajuste IPCA (6.8) ---
  @Get('contratos/:id/reajustes')
  reajustes(@Param('id') id: string) {
    return this.reajuste.listar(id);
  }

  // Propõe o reajuste — aprovação e aplicação acontecem via motor (§7.9-A).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/reajuste')
  @HttpCode(201)
  gerarReajuste(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reajusteSchema)) dto: ReajusteBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reajuste.gerar(id, dto.indicePercentual, user.id);
  }
}
