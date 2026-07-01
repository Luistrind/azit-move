import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { PrismaService } from '../../database/prisma.service';
import { FaturaService } from './fatura.service';
import { QUEUE_NAMES } from '../queues/queues.module';

@Controller()
export class CobrancaController {
  constructor(
    private readonly fatura: FaturaService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.PAGAMENTO_RECEBIDO)
    private readonly filaRecebido: Queue,
  ) {}

  // 4.9 — Extrato do contrato (eventos conciliados).
  @Get('contratos/:id/extrato')
  extrato(@Param('id') id: string) {
    return this.fatura.extrato(id);
  }

  // Visão de faturas do cliente (por conta), paginada — agrega itens de vários contratos.
  @Get('contas/:contaId/faturas')
  faturas(
    @Param('contaId') contaId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fatura.faturasDaConta(contaId, Number(page) || 1, Number(limit) || 8);
  }

  // Detalhe de uma fatura (composição + datas + valores).
  @Get('faturas/:id')
  detalheFatura(@Param('id') id: string) {
    return this.fatura.detalheFatura(id);
  }

  // Dev: dispara o fechamento D-5 manualmente (em prod é job agendado).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/fechar-faturas')
  fecharFaturas() {
    return this.fatura.fechar();
  }

  // Dev: simula o pagamento de UMA fatura (o que o cliente paga é a fatura, não a
  // parcela) — enfileira o MESMO job do webhook do Asaas (conciliação real).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/simular-pagamento-fatura/:faturaId')
  @HttpCode(202)
  async simularPagamentoFatura(@Param('faturaId') faturaId: string) {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      select: { id: true, status: true, dataVencimento: true },
    });
    if (!fatura) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    }
    if (fatura.status === 'PAGA' || fatura.status === 'PAGA_EM_ATRASO') {
      return { enfileirado: false, motivo: 'ja_paga', faturaId };
    }
    await this.filaRecebido.add('conciliar', {
      faturaId: fatura.id,
      paymentDate: new Date().toISOString().slice(0, 10),
      dueDate: fatura.dataVencimento.toISOString().slice(0, 10),
      valor: 0,
    });
    return { enfileirado: true, faturaId };
  }

  // Dev: "envelhece" a fatura em N dias (default 1) — simula atraso dia a dia.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/envelhecer-fatura/:faturaId')
  @HttpCode(200)
  envelhecerFatura(@Param('faturaId') faturaId: string, @Query('dias') dias?: string) {
    return this.fatura.envelhecerFatura(faturaId, Number(dias) || 1);
  }

  // Dev: simula o pagamento da próxima parcela em aberto do contrato, enfileirando
  // o MESMO job que o webhook do Asaas geraria (exercita a conciliação real).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/simular-pagamento/:contratoId')
  @HttpCode(202)
  async simularPagamento(@Param('contratoId') contratoId: string) {
    const parcela = await this.prisma.db.parcela.findFirst({
      where: { contratoId, status: null, faturaId: { not: null }, acordoId: null },
      orderBy: { dataVencimento: 'asc' },
      select: { faturaId: true, dataVencimento: true },
    });
    if (!parcela?.faturaId) {
      throw new NotFoundException({
        erro: 'sem_parcela_em_aberto',
        mensagem: 'Não há parcela em aberto com fatura para este contrato',
      });
    }
    await this.filaRecebido.add('conciliar', {
      faturaId: parcela.faturaId,
      paymentDate: new Date().toISOString().slice(0, 10),
      dueDate: parcela.dataVencimento.toISOString().slice(0, 10),
      valor: 0,
    });
    return { enfileirado: true, faturaId: parcela.faturaId };
  }
}
