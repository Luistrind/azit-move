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
import { bloqueioDisponivel, dataHojeBrasil, diasAtrasoCalendario, DIA_MS, DIAS_BLOQUEIO_DISPONIVEL, DIAS_RECUPERACAO_DISPONIVEL, FUSO_NEGOCIO, inicioHojeBrasilUTC, recuperacaoDisponivel, resolverEstagioRegua } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { FaturaService } from '../cobranca/fatura.service';
import { QUEUE_NAMES } from '../queues/queues.module';

const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// Modelo de 3 camadas (doc 02 §5.2, 07/09): a régua seleciona contratos ATIVOS
// e deriva o caso do ATRASO calculado + intervenções (bloqueio/recuperação) —
// não existe mais status INADIMPLENTE gravado.

@Injectable()
export class ReguaService {
  private readonly logger = new Logger(ReguaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fatura: FaturaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICAR_CLIENTE)
    private readonly filaNotificar: Queue,
    @InjectQueue(QUEUE_NAMES.REGUA_STEP)
    private readonly filaRegua: Queue,
  ) {}

  private hojeUTC(): Date {
    return inicioHojeBrasilUTC(); // fuso do negócio (correção 30/08)
  }

  // 5.6 — Dados do kanban: contratos em régua com estágio e dias de atraso.
  async listar() {
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { status: 'ATIVO' },
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
    // Raia "Vence hoje" (decisão Luís 31/10, doc 02 §7.6): parcelas que vencem
    // HOJE (fuso do Brasil), fora de acordo — o caso entra no quadro antes de
    // atrasar, para o lembrete do dia. Não é atraso: diasAtraso continua 0.
    const vencendoHoje = await this.prisma.db.parcela.groupBy({
      by: ['contratoId'],
      where: { contratoId: { in: ids }, status: null, dataVencimento: { gte: hoje, lt: new Date(hoje.getTime() + DIA_MS) }, acordoId: null },
      _sum: { valorNominal: true },
      _count: { _all: true },
    });
    const hojePorId = new Map(vencendoHoje.map((v) => [v.contratoId, v]));

    return contratos
      .map((c) => {
        const v = porId.get(c.id);
        const maisAntiga = v?._min.dataVencimento;
        // Dias de CALENDÁRIO (correção 31/08): venceu ontem = 1 dia, sempre.
        const diasAtraso = maisAntiga ? diasAtrasoCalendario(maisAntiga) : 0;
        const h = hojePorId.get(c.id);
        return {
          id: c.id,
          numero: c.numero,
          // Fluxo do operador de cobrança (18/08): o card da régua abre o caso e
          // renegocia dali — a renegociação é da CONTA (doc 02 §7.7).
          contaId: c.contaId,
          bloqueado: c.veiculoBloqueadoEm !== null,
          emRecuperacao: c.recuperacaoIniciadaEm !== null,
          diasAtraso,
          estagio: resolverEstagioRegua(diasAtraso),
          valorVencido: cent(v?._sum.valorNominal ?? null),
          parcelasVencidas: v?._count._all ?? 0,
          // Raia "Vence hoje": o que vence no dia (sem atraso ainda).
          valorVenceHoje: cent(h?._sum.valorNominal ?? null),
          parcelasVenceHoje: h?._count._all ?? 0,
          // Bloqueio disponível a partir da raia "até 14 dias" (DIAS_BLOQUEIO_DISPONIVEL, 31/10).
          bloqueioDisponivel: bloqueioDisponivel(diasAtraso),
          // "Iniciar recuperação" a partir da raia "até 30 dias" (DIAS_RECUPERACAO_DISPONIVEL, doc 02 §29.1).
          recuperacaoDisponivel: recuperacaoDisponivel(diasAtraso),
          titular: c.conta.titular,
          ativo: c.ativo,
        };
      })
      // Kanban por DIAS de atraso (decisão 31/08, raias 31/10): entra na régua a
      // partir de 1 dia de calendário OU com parcela vencendo hoje — e permanece
      // enquanto houver intervenção ativa (bloqueio/recuperação), mesmo sem
      // atraso, até o desbloqueio manual.
      .filter((c) => c.diasAtraso >= 1 || c.parcelasVenceHoje > 0 || c.bloqueado || c.emRecuperacao);
  }

  // Job agendado: varre a régua diariamente (madrugada). Em dev o operador também
  // pode disparar via /dev/varrer-regua.
  // ENFILEIRA em vez de rodar in-process (auditoria 15/09, P0-6): o worker da
  // fila REGUA_STEP tem retry/backoff, e o jobId diário deduplica entre réplicas.
  // Horário e chave do job no fuso do negócio (Regra 15): o container roda em UTC.
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: FUSO_NEGOCIO })
  async cronRegua(): Promise<void> {
    await this.filaRegua.add(
      'rodar',
      {},
      { jobId: `regua-${dataHojeBrasil()}`, removeOnComplete: true, removeOnFail: 50 },
    );
    this.logger.log('[cron] varredura da régua enfileirada');
  }

  // 5.1 + 5.3 — Varre faturas vencidas (marca inadimplência) e dispara as ações
  // automáticas da régua (WhatsApp em D+1/D+2). Job em prod; trigger dev aqui.
  async rodar() {
    const hoje = this.hojeUTC();
    // Vocabulário 07/09: "vencida" é situação CALCULADA por data — a varredura
    // não grava mais estado na fatura; só conta para o relatório da rodada.
    const aVencer = await this.prisma.db.fatura.count({
      where: {
        status: { in: ['ABERTA', 'FECHADA'] },
        dataVencimento: { lt: hoje },
      },
    });

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
    return { faturasVencidas: aVencer, emRegua: emRegua.length, notificados };
  }

  // 5.4 — Bloqueio do veículo (registrado no sistema; integração externa é
  // placeholder). Disponível a partir da raia "Vencida até 14 dias" do kanban
  // (DIAS_BLOQUEIO_DISPONIVEL em @azit/utils — decisão Luís 31/10, doc 02 §7.6;
  // substitui o gatilho D+3). Desbloqueio continua sempre manual.
  // Modelo de 3 camadas (07/09): bloqueio é INTERVENÇÃO (carimbo), não fase —
  // o contrato segue ATIVO com o veículo bloqueado.
  async bloquear(contratoId: string, usuarioId?: string) {
    const { contrato, diasAtraso } = await this.contratoComAtraso(contratoId);
    if (contrato.status !== 'ATIVO') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: `Só é possível bloquear contrato em vida (fase atual: ${contrato.status})`,
      });
    }
    if (contrato.veiculoBloqueadoEm) {
      throw new UnprocessableEntityException({ erro: 'ja_bloqueado', mensagem: 'O veículo já está bloqueado' });
    }
    if (!bloqueioDisponivel(diasAtraso)) {
      throw new UnprocessableEntityException({
        erro: 'antes_da_raia_de_bloqueio',
        mensagem: `Bloqueio só a partir de ${DIAS_BLOQUEIO_DISPONIVEL} dias de atraso (raia "Vencida até 14 dias")`,
      });
    }
    await this.prisma.db.contratoCredito.update({
      where: { id: contratoId },
      data: { veiculoBloqueadoEm: new Date() },
    });
    // Auditoria: bloqueio é evento sensível — registra o responsável (reunião 13/07).
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'contrato_bloqueado',
        entidade: 'contrato',
        entidadeId: contratoId,
        antes: { veiculoBloqueado: false },
        depois: { veiculoBloqueado: true, diasAtraso },
      },
    });
    // Placeholder: integração de bloqueio remoto do veículo (telemetria).
    this.logger.warn(`[bloqueio] veículo do contrato ${contrato.numero} — comando remoto (stub)`);
    return { resultado: 'bloqueado' };
  }

  // 5.5 — Desbloqueio sempre manual, após confirmação de regularização: limpa o
  // carimbo; a situação financeira (em dia/em atraso/em acordo) é calculada.
  async desbloquear(contratoId: string, usuarioId?: string) {
    const { contrato, diasAtraso } = await this.contratoComAtraso(contratoId);
    if (!contrato.veiculoBloqueadoEm) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'O veículo não está bloqueado',
      });
    }
    await this.prisma.db.contratoCredito.update({
      where: { id: contratoId },
      data: { veiculoBloqueadoEm: null },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'contrato_desbloqueado',
        entidade: 'contrato',
        entidadeId: contratoId,
        antes: { veiculoBloqueado: true },
        depois: { veiculoBloqueado: false, diasAtraso },
      },
    });
    this.logger.warn(`[desbloqueio] contrato ${contrato.numero} (stub remoto)`);
    return { resultado: 'desbloqueado', diasAtraso };
  }

  // Doc 02 §29.1 (04/11): recuperação do veículo é INTERVENÇÃO (carimbo), manual,
  // disponível a partir da raia "Vencida até 30 dias". O contrato segue ATIVO.
  async iniciarRecuperacao(contratoId: string, usuarioId?: string) {
    const { contrato, diasAtraso } = await this.contratoComAtraso(contratoId);
    if (contrato.status !== 'ATIVO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: `Só contrato em vida entra em recuperação (fase atual: ${contrato.status})` });
    }
    if (contrato.recuperacaoIniciadaEm) {
      throw new UnprocessableEntityException({ erro: 'ja_em_recuperacao', mensagem: 'A recuperação do veículo já foi iniciada' });
    }
    if (!recuperacaoDisponivel(diasAtraso)) {
      throw new UnprocessableEntityException({
        erro: 'antes_da_raia_de_recuperacao',
        mensagem: `Recuperação só a partir de ${DIAS_RECUPERACAO_DISPONIVEL} dias de atraso (raia "Vencida até 30 dias")`,
      });
    }
    await this.prisma.db.contratoCredito.update({ where: { id: contratoId }, data: { recuperacaoIniciadaEm: new Date() } });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'recuperacao_iniciada', entidade: 'contrato', entidadeId: contratoId, antes: { emRecuperacao: false }, depois: { emRecuperacao: true, diasAtraso } },
    });
    return { resultado: 'recuperacao_iniciada', diasAtraso };
  }

  // Encerrar recuperação (cliente regularizou / retomada não aconteceu): sempre manual.
  async encerrarRecuperacao(contratoId: string, usuarioId?: string) {
    const { contrato, diasAtraso } = await this.contratoComAtraso(contratoId);
    if (!contrato.recuperacaoIniciadaEm) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'O contrato não está em recuperação' });
    }
    if (contrato.status !== 'ATIVO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Contrato encerrado: a recuperação faz parte do histórico' });
    }
    await this.prisma.db.contratoCredito.update({ where: { id: contratoId }, data: { recuperacaoIniciadaEm: null } });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'recuperacao_encerrada', entidade: 'contrato', entidadeId: contratoId, antes: { emRecuperacao: true }, depois: { emRecuperacao: false, diasAtraso } },
    });
    return { resultado: 'recuperacao_encerrada', diasAtraso };
  }

  private async contratoComAtraso(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, status: true, veiculoBloqueadoEm: true, recuperacaoIniciadaEm: true },
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
    const diasAtraso = dv ? diasAtrasoCalendario(dv) : 0;
    return { contrato, diasAtraso };
  }
}
