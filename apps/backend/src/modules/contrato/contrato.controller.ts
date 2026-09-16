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
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ContratoService } from './contrato.service';
import {
  listarContratosSchema,
  ListarContratosDto,
} from './dto/listar-contratos.dto';

@Controller('contratos')
export class ContratoController {
  constructor(private readonly contratoService: ContratoService) {}

  // POST /contratos REMOVIDO (auditoria 15/09, P0-4): criava contrato FORA da
  // esteira de crédito (sem análise, alçada ou catálogo congelado) e nenhuma
  // tela o usava. Contrato nasce pela formalização do funil, pelos produtos
  // adicionais (crédito/RP) ou pela novação — todos via ContratoService.criar.

  // Bloco B (decisão Luís 15/09): cancelamento MANUAL de contrato não
  // efetivado (aguardando assinatura/pagamento inicial) — libera o veículo e
  // devolve a proposta para reformalização. Novação cai no desmonte próprio.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR)
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @Param('id') id: string,
    @Body() body: { motivo?: string } | undefined,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const motivo = (body?.motivo ?? '').trim() || 'Cancelado pelo operador';
    return this.contratoService.cancelarNaoEfetivado(id, motivo, user.id);
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

  // Reserva de domínio transferida ao cliente (doc 02 §5.2, 07/09) — ação manual
  // em contrato Encerrado por quitação.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO)
  @Post(':id/transferencia-efetivada')
  @HttpCode(200)
  transferenciaEfetivada(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.contratoService.registrarTransferencia(id, user.id);
  }
}
