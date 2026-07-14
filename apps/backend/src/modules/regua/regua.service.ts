import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { resolverEstagioRegua } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { FaturaService } from '../cobranca/fatura.service';
import { QUEUE_NAMES } from '../queues/queues.module';

const DIA_MS = 24 * 60 * 60 * 1000;
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

const STATUS_REGUA = ['INADIMPLENTE', 'BLOQUEADO', 'EM_RECUPERACAO_VEICULO'] as const;

@Injectable()
export class ReguaService {
  private readonly logger = new Logger(ReguaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fatura: FaturaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICAR_CLIENTE)
    private readonly filaNotificar: Queue,
  ) {}

  private hojeUTC(): Date {
    return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  }

  // 5.6 — Dados do kanban: contratos em régua com estágio e dias de atraso.
  async listar() {
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { status: { in: [...STATUS_REGUA] } },
      include: {
        conta: { include: { titular: { select: { nome: true, cpfCnpj: true } } } },
        ativo: { select: { placa: true, modelo: true } },
      },
    });
    if (contratos.length === 0) return [];

    const hoje = this.hojeUTC();
    const ids = contratos.map((c) => c.id);
    const vencidas = await this.prisma.db.parcela.groupBy({
      by: ['contratoId'],
      // parcelas vencidas não cobertas por acordo (acordoId) entram na régua.
      where: { contratoId: { in: ids }, status: null, dataVencimento: { lt: hoje }, acordoId: null },
      _min: { dataVencimento: true },
      _sum: { valorNominal: true },
      _count: { _all: true },
    });
    const porId = new Map(vencidas.map((v) => [v.contratoId, v]));

    return contratos
      .map((c) => {
        const v = porId.get(c.id);
        const maisAntiga = v?._min.dataVencimento;
        const diasAtraso = maisAntiga
          ? Math.floor((hoje.getTime() - maisAntiga.getTime()) / DIA_MS)
          : 0;
        return {
          id: c.id,
          numero: c.numero,
          bloqueado: c.status === 'BLOQUEADO',
          emRecuperacao: c.status === 'EM_RECUPERACAO_VEICULO',
          diasAtraso,
          estagio: resolverEstagioRegua(diasAtraso),
          valorVencido: cent(v?._sum.valorNominal ?? null),
          parcelasVencidas: v?._count._all ?? 0,
          titular: c.conta.titular,
          ativo: c.ativo,
        };
      })
      .filter((c) => c.estagio !== null);
  }

  // Job agendado: varre a régua diariamente (madrugada). Em dev o operador também
  // pode disparar via /dev/varrer-regua.
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cronRegua(): Promise<void> {
    await this.rodar();
    this.logger.log('[cron] régua varrida');
  }

  // 5.1 + 5.3 — Varre faturas vencidas (marca inadimplência) e dispara as ações
  // automáticas da régua (WhatsApp em D+1/D+2). Job em prod; trigger dev aqui.
  async rodar() {
    const hoje = this.hojeUTC();
    const aVencer = await this.prisma.db.fatura.findMany({
      where: {
        status: { in: ['ABERTA', 'FECHADA'] },
        dataVencimento: { lt: hoje },
      },
      select: { id: true },
    });
    for (const f of aVencer) {
      await this.fatura.marcarVencida(f.id);
    }

    const emRegua = await this.listar();
    let notificados = 0;
    for (const c of emRegua) {
      if (c.estagio === 'D+1' || c.estagio === 'D+2') {
        await this.filaNotificar.add('cobranca', {
          contratoId: c.id,
          estagio: c.estagio,
        });
        notificados += 1;
      }
    }
    return { faturasVencidas: aVencer.length, emRegua: emRegua.length, notificados };
  }

  // 5.4 — Bloqueio D+3 (regra absoluta, registrado no sistema; integração externa
  // é placeholder). Só permitido a partir de D+3.
  async bloquear(contratoId: string, usuarioId?: string) {
    const { contrato, diasAtraso } = await this.contratoComAtraso(contratoId);
    if (contrato.status !== 'INADIMPLENTE') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: `Só é possível bloquear contrato inadimplente (atual: ${contrato.status})`,
      });
    }
    if (diasAtraso < 3) {
      throw new UnprocessableEntityException({
        erro: 'antes_do_d3',
        mensagem: 'Bloqueio só a partir de D+3',
      });
    }
    await this.prisma.db.contratoCredito.update({
      where: { id: contratoId },
      data: { status: 'BLOQUEADO' },
    });
    // Auditoria: bloqueio é evento sensível — registra o responsável (reunião 13/07).
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'contrato_bloqueado',
        entidade: 'contrato',
        entidadeId: contratoId,
        antes: { status: contrato.status },
        depois: { status: 'BLOQUEADO', diasAtraso },
      },
    });
    // Placeholder: integração de bloqueio remoto do veículo (telemetria).
    this.logger.warn(`[bloqueio] veículo do contrato ${contrato.numero} — comando remoto (stub)`);
    return { resultado: 'bloqueado' };
  }

  // 5.5 — Desbloqueio sempre manual, após confirmação de regularização.
  async desbloquear(contratoId: string, usuarioId?: string) {
    const { contrato, diasAtraso } = await this.contratoComAtraso(contratoId);
    if (contrato.status !== 'BLOQUEADO') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Contrato não está bloqueado',
      });
    }
    // Se ainda há atraso, volta a Inadimplente; se regularizado, a Ativo.
    const novoStatus = diasAtraso >= 1 ? 'INADIMPLENTE' : 'ATIVO';
    await this.prisma.db.contratoCredito.update({
      where: { id: contratoId },
      data: { status: novoStatus },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'contrato_desbloqueado',
        entidade: 'contrato',
        entidadeId: contratoId,
        antes: { status: 'BLOQUEADO' },
        depois: { status: novoStatus, diasAtraso },
      },
    });
    this.logger.warn(`[desbloqueio] contrato ${contrato.numero} -> ${novoStatus} (stub remoto)`);
    return { resultado: 'desbloqueado', status: novoStatus };
  }

  private async contratoComAtraso(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, status: true },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }
    const hoje = this.hojeUTC();
    const maisAntiga = await this.prisma.db.parcela.aggregate({
      where: { contratoId, status: null, dataVencimento: { lt: hoje }, acordoId: null },
      _min: { dataVencimento: true },
    });
    const dv = maisAntiga._min.dataVencimento;
    const diasAtraso = dv ? Math.floor((hoje.getTime() - dv.getTime()) / DIA_MS) : 0;
    return { contrato, diasAtraso };
  }
}
