import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
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

  // Dev: dispara o fechamento D-5 manualmente (em prod é job agendado).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('dev/fechar-faturas')
  fecharFaturas() {
    return this.fatura.fechar();
  }

  // Dev: simula o pagamento da próxima parcela em aberto do contrato, enfileirando
  // o MESMO job que o webhook do Asaas geraria (exercita a conciliação real).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('dev/simular-pagamento/:contratoId')
  @HttpCode(202)
  async simularPagamento(@Param('contratoId') contratoId: string) {
    const parcela = await this.prisma.db.parcela.findFirst({
      where: { contratoId, status: null, faturaId: { not: null } },
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
