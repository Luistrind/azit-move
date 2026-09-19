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
import { diasAtrasoCalendario, inicioHojeBrasilUTC, resolverEstagioRegua } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { FaturaService } from '../cobranca/fatura.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { NotificacaoCobrancaService } from '../notificacao-cobranca/notificacao-cobranca.service';
import { ConversaService } from '../notificacao-cobranca/conversa.service';

const DIA_MS = 24 * 60 * 60 * 1000;
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
    private readonly notificacoes: NotificacaoCobrancaService,
    private readonly conversas: ConversaService,
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
        conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } },
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
    // Estado do POP-COB-001 (doc 02 §23) — só contratos de veículo; o card
    // mostra a etapa, a próxima notificação e os sinais (monitorar/bloqueio/rescisão).
    const pop = await this.notificacoes.avaliarPorIds(ids);
    // Respostas do cliente ainda não lidas (conversas do WhatsApp — doc 02 §24).
    const naoLidas = await this.conversas.naoLidasPorTitular([...new Set(contratos.map((c) => c.conta.titularId))]);

    return contratos
      .map((c) => {
        const v = porId.get(c.id);
        const maisAntiga = v?._min.dataVencimento;
        // Dias de CALENDÁRIO (correção 31/08): venceu ontem = 1 dia, sempre.
        const diasAtraso = maisAntiga ? diasAtrasoCalendario(maisAntiga) : 0;
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
          titular: c.conta.titular,
          ativo: c.ativo,
          retomado: c.veiculoRetomadoEm !== null,
          noJuridico: c.cobrancaJuridicaEm !== null,
          mensagensNaoLidas: naoLidas.get(c.conta.titularId) ?? 0,
          pop: (() => {
            const e = pop.get(c.id);
            if (!e) return null;
            const a = e.avaliacao;
            return {
              fase: a.fase,
              ultimaEtapa: a.ultimaEtapa,
              proxima: a.proxima ? { etapa: a.proxima.etapa, condicao: a.proxima.condicao, prevista: a.proxima.prevista?.toISOString() ?? null } : null,
              monitorarVeiculo: a.monitorarVeiculo,
              bloqueioLiberado: a.bloqueioLiberado,
              bloqueioLiberadoEm: a.bloqueioLiberadoEm?.toISOString() ?? null,
              rescisaoSinalizada: a.rescisaoSinalizada,
              parcelasVencidas: e.vencimentos.length, // vencimentos distintos (veículo + proteção = 1)
            };
          })(),
        };
      })
      // Kanban por DIAS de atraso (decisão 31/08): entra na régua a partir de
      // 1 dia de calendário — e permanece enquanto houver intervenção ativa
      // (bloqueio/recuperação), mesmo sem atraso, até o desbloqueio manual.
      .filter((c) => c.diasAtraso >= 1 || c.bloqueado || c.emRecuperacao);
  }

  // Job agendado: varre a régua diariamente (madrugada). Em dev o operador também
  // pode disparar via /dev/varrer-regua.
  // ENFILEIRA em vez de rodar in-process (auditoria 15/09, P0-6): o worker da
  // fila REGUA_STEP tem retry/backoff, e o jobId diário deduplica entre réplicas.
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cronRegua(): Promise<void> {
    await this.filaRegua.add(
      'rodar',
      {},
      { jobId: `regua-${new Date().toISOString().slice(0, 10)}`, removeOnComplete: true, removeOnFail: 50 },
    );
    this.logger.log('[cron] varredura da régua enfileirada');
  }

  // 5.1 — Varredura diária da régua (relatório da rodada). As mensagens ao
  // cliente NÃO saem mais daqui (o antigo stub D+1/D+2 foi substituído pelas
  // notificações do POP-COB-001, doc 02 §23 — módulo notificacao-cobranca,
  // de hora em hora na janela de dias úteis).
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
    return { faturasVencidas: aVencer, emRegua: emRegua.length };
  }

  // 5.4 — Bloqueio (Regra 6 reescrita em 19/09 — POP-COB-001, doc 02 §23):
  // liberado 24h após a 4ª notificação sem regularização; ANTES disso só com
  // justificativa registrada (risco concreto — cláusulas 8.3/7.7), e nunca
  // antes do D+1. Integração remota é placeholder.
  // Modelo de 3 camadas (07/09): bloqueio é INTERVENÇÃO (carimbo), não fase —
  // o contrato segue ATIVO com o veículo bloqueado.
  async bloquear(contratoId: string, usuarioId?: string, justificativa?: string) {
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
    if (diasAtraso < 1) {
      throw new UnprocessableEntityException({
        erro: 'sem_atraso',
        mensagem: 'Bloqueio só com parcela vencida (a partir do D+1)',
      });
    }
    const pop = (await this.notificacoes.avaliarPorIds([contratoId])).get(contratoId)?.avaliacao;
    const liberadoPeloPop = !!pop?.bloqueioLiberado;
    const motivo = justificativa?.trim() ?? '';
    if (!liberadoPeloPop && motivo.length < 15) {
      const quando = pop?.bloqueioLiberadoEm
        ? `O POP libera o bloqueio em ${pop.bloqueioLiberadoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} (24h após a 4ª notificação).`
        : 'O POP só libera o bloqueio 24h após a 4ª notificação.';
      throw new UnprocessableEntityException({
        erro: 'fora_do_pop',
        mensagem: `${quando} Para bloquear antes, registre a justificativa (risco concreto — cláusulas 8.3/7.7), com pelo menos 15 caracteres.`,
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
        depois: {
          veiculoBloqueado: true,
          diasAtraso,
          liberadoPeloPop,
          ultimaNotificacao: pop?.ultimaEtapa ?? null,
          justificativa: liberadoPeloPop ? null : motivo,
        },
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

  private async contratoComAtraso(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, status: true, veiculoBloqueadoEm: true },
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
