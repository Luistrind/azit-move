import { Controller, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { dataHojeBrasil } from '@azit/utils';
import { Area, AREAS_FICHA_TITULAR } from '../../common/decorators/area.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { PrismaService } from '../../database/prisma.service';
import { IntencaoPagamentoService } from './intencao-pagamento.service';

// Ações do OPERADOR sobre o Pix sob demanda de uma conta (doc 02 §32.4-A),
// usadas na ficha do titular.
@Area(AreaSistema.CARTEIRA_COBRANCA, ...AREAS_FICHA_TITULAR)
@Controller()
export class PagamentoContaController {
  constructor(
    private readonly intencao: IntencaoPagamentoService,
    private readonly prisma: PrismaService,
  ) {}

  // "O cliente pagou e a fatura não baixou?" — pergunta ao gateway pelos Pix
  // recentes da conta e enfileira a baixa dos que ele confirma como pagos
  // (Regra 4: 202, nunca baixa síncrona; nada é alterado no gateway).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO, RoleUsuario.DIRETOR)
  @Post('contas/:contaId/pix/conferir')
  @HttpCode(202)
  conferir(@Param('contaId') contaId: string) {
    return this.intencao.conferirConta(contaId);
  }

  // Dev/homologação: simula o pagamento do Pix de uma intenção pelo MESMO
  // caminho do webhook do QR estático — job 'identificar' com o id do Pix, que
  // acha a intenção e enfileira a baixa pela conta. Vale para os dois modos (a
  // intenção é achada pelo id do Pix). Em produção a rota não existe.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/simular-pagamento-pix/:intencaoId')
  @HttpCode(202)
  async simularPagamento(@Param('intencaoId') intencaoId: string) {
    const i = await this.prisma.db.intencaoPagamento.findFirst({ where: { id: intencaoId }, select: { id: true, valor: true, gatewayId: true } });
    if (!i || !i.gatewayId) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Pix não encontrado' });
    await this.intencao.enfileirarIdentificacao({
      pagamentoId: `pay_sim_${i.id}`,
      gatewayId: i.gatewayId,
      valor: Math.round(Number(i.valor.toString()) * 100),
      dataPagamento: dataHojeBrasil(),
      recebidoEm: new Date().toISOString(),
      identificadorPix: `SIMULADO-${i.id}`,
    });
    return { enfileirado: true, intencaoId: i.id };
  }
}
