import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RoleUsuario } from '@prisma/client';
import { dataHojeBrasil } from '@azit/utils';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { PrismaService } from '../../database/prisma.service';
import { FaturaService } from './fatura.service';
import { AsaasLeituraService } from '../asaas/asaas-leitura.service';
import { QUEUE_NAMES } from '../queues/queues.module';

@Controller()
export class CobrancaController {
  constructor(
    private readonly fatura: FaturaService,
    private readonly prisma: PrismaService,
    private readonly asaasLeitura: AsaasLeituraService,
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

  // Lançamentos avulsos da conta (entradas de contrato/acordo — doc 02 §4-A.3, 30/08).
  @Get('contas/:contaId/lancamentos')
  lancamentos(@Param('contaId') contaId: string) {
    return this.fatura.lancamentosDaConta(contaId);
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

  // Operacional (também em produção): dispara a varredura de cobranças pendentes
  // sem esperar o cron das 3h30 — reenfileira FECHADA sem chargeId e alerta as
  // vencidas. Idempotente (correção 08/09).
  @Roles(RoleUsuario.ADMIN)
  @Post('cobrancas/varrer')
  varrerCobrancas() {
    return this.fatura.varrerCobrancasPendentes();
  }

  // Reemissão manual pela tela (plano de contingência 08/09): fatura FECHADA sem
  // cobrança no Asaas — o sistema emite mantendo o vínculo (externalReference),
  // para o webhook conciliar sozinho. Vencida sai com vencimento >= hoje, com ou
  // sem o encargo corrido (escolha do operador no modal).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO, RoleUsuario.DIRETOR)
  @Post('faturas/:id/gerar-cobranca')
  @HttpCode(201)
  gerarCobrancaManual(
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(
        z.object({
          vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          incluirEncargo: z.boolean().optional(),
        }),
      ),
    )
    dto: { vencimento?: string; incluirEncargo?: boolean },
  ) {
    return this.fatura.emitirCobrancaManual(id, dto);
  }

  // Conferir pagamento no Asaas (02/10): a fatura tem cobrança e segue em aberto
  // no sistema — consulta a cobrança AO VIVO e, se o Asaas diz que foi paga,
  // enfileira a MESMA conciliação do webhook (valor e data reais). Serve para
  // pagamento que o webhook não entregou (fila pausada, servidor fora) ou que
  // ficou como parcial por defeito já corrigido. Nunca baixa nada sem o Asaas
  // confirmar o recebimento.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO, RoleUsuario.DIRETOR)
  @Post('faturas/:id/conferir-pagamento')
  @HttpCode(200)
  async conferirPagamento(@Param('id') id: string) {
    const fatura = await this.prisma.db.fatura.findFirst({ where: { id }, select: { id: true, status: true, asaasChargeId: true, dataVencimento: true } });
    if (!fatura) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    if (fatura.status === 'PAGA' || fatura.status === 'PAGA_EM_ATRASO') return { enfileirado: false, statusAsaas: null, motivo: 'A fatura já está paga no sistema' };
    if (!fatura.asaasChargeId) throw new UnprocessableEntityException({ erro: 'sem_cobranca', mensagem: 'Esta fatura não tem cobrança no Asaas' });
    if (this.asaasLeitura.ambiente === 'simulado') throw new UnprocessableEntityException({ erro: 'asaas_simulado', mensagem: 'Asaas em modo simulado — não há o que conferir' });
    const pg = await this.asaasLeitura.requisicao<{ status: string; value: number; paymentDate?: string | null; clientPaymentDate?: string | null; confirmedDate?: string | null; dueDate: string }>('GET', `/payments/${fatura.asaasChargeId}`);
    const recebida = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(pg.status);
    if (!recebida) return { enfileirado: false, statusAsaas: pg.status, motivo: 'O Asaas ainda não registra o recebimento desta cobrança' };
    await this.filaRecebido.add('conciliar', {
      faturaId: fatura.id,
      paymentDate: pg.clientPaymentDate ?? pg.paymentDate ?? pg.confirmedDate ?? dataHojeBrasil(),
      dueDate: pg.dueDate,
      valor: Math.round(pg.value * 100),
    });
    return { enfileirado: true, statusAsaas: pg.status, motivo: null };
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
      select: { id: true, status: true, dataVencimento: true, valorTotal: true },
    });
    if (!fatura) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    }
    if (fatura.status === 'PAGA' || fatura.status === 'PAGA_EM_ATRASO') {
      return { enfileirado: false, motivo: 'ja_paga', faturaId };
    }
    await this.filaRecebido.add('conciliar', {
      faturaId: fatura.id,
      paymentDate: dataHojeBrasil(),
      dueDate: fatura.dataVencimento.toISOString().slice(0, 10),
      // Valor REAL da fatura (02/10): com 0 a simulação pulava a checagem de
      // pagamento parcial e escondeu o defeito da proteção somada em dobro.
      valor: Math.round(Number(fatura.valorTotal.toString()) * 100),
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
      paymentDate: dataHojeBrasil(),
      dueDate: parcela.dataVencimento.toISOString().slice(0, 10),
      valor: 0,
    });
    return { enfileirado: true, faturaId: parcela.faturaId };
  }
}
