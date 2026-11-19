import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  dataHojeBrasil,
  decidirConferenciaAutomatica,
  divergenciasNovas,
  formatCurrency,
  FUSO_NEGOCIO,
  situacaoFaturaRuntime,
  type ClassificacaoConferenciaAsaas,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { ConferenciaAsaasService, type LinhaConferenciaAsaas } from './conferencia-asaas.service';

// Conferência AUTOMÁTICA diária "Asaas × sistema" (doc 02 §27.9.1, 18/11/2026).
// Origem: a v1.9.0 desviava o aviso de Pix de cobrança comum para o fluxo do Pix
// sob demanda e a fatura não baixava (Leonardo, fatura 191; Pedro Jose, fatura
// 49). Uma vez por dia, sem ninguém abrir a tela, a conferência do §27.9 lê no
// Asaas TODAS as faturas em aberto aqui com cobrança (vencidas, de hoje e a
// vencer) e baixa as que o Asaas diz que foram pagas — pelo MESMO Reconciliar,
// que enfileira o MESMO job `conciliar` do webhook. O resto só é listado.
// Nada é alterado no Asaas (Regra 1); nada roda dentro do cron (Regra 4).

// Horário da rodada, fuso do Brasil (Regra 15). PROVISÓRIO — escolha da
// implementação (antes da régua das 4h, para quem já pagou não entrar em ação de
// cobrança), a confirmar pelo Luís. Único lugar: o cron e a tela leem daqui.
export const HORARIO_CONFERENCIA_ASAAS_AUTOMATICA = { hora: 3, minuto: 30 } as const;
const CRON_CONFERENCIA = `${HORARIO_CONFERENCIA_ASAAS_AUTOMATICA.minuto} ${HORARIO_CONFERENCIA_ASAAS_AUTOMATICA.hora} * * *`;
export const ROTULO_HORARIO_CONFERENCIA = `${HORARIO_CONFERENCIA_ASAAS_AUTOMATICA.hora}h${String(HORARIO_CONFERENCIA_ASAAS_AUTOMATICA.minuto).padStart(2, '0')}`;

// Onde cada rodada fica registrada (sem tabela nova).
export const ACAO_LOG_CONFERENCIA = 'conferencia_asaas_automatica';
export const ENTIDADE_LOG_CONFERENCIA = 'conferencia_asaas';
// O aviso abre a Carteira com a conferência aberta.
export const ROTA_CONFERENCIA = '/carteira?conferencia=asaas';

// Chaves de job (BullMQ recusa ':' em jobId). A da rodada agendada é pelo dia:
// réplicas da API disparando juntas viram um job só. A do `conciliar` é por dia e
// fatura: rodar duas vezes no dia não enfileira duas conciliações da mesma fatura.
export const jobIdRodadaDoDia = (dia: string) => `conferencia-asaas-${dia}`;
export const jobIdConciliacaoAutomatica = (dia: string, faturaId: string) => `conferencia-auto-${dia}-${faturaId}`;

export type OrigemRodada = 'agendada' | 'manual';
export interface JobRodadaConferencia {
  origem: OrigemRodada;
  usuarioId?: string;
}

export type ClassificacaoDaRodada = ClassificacaoConferenciaAsaas | 'pago_a_menor_ja_registrado';

export interface ItemRodadaConferencia {
  faturaId: string;
  numero: number;
  titularId: string;
  titular: string;
  vencimento: string; // YYYY-MM-DD
  situacao: 'vencida' | 'vence_hoje' | 'a_vencer'; // runtime (Regra 7), no dia da rodada
  valorAqui: number; // centavos
  asaasChargeId: string;
  statusAsaas: string | null; // null = 404 no Asaas
  valorAsaas: number | null; // centavos
  dataPagamentoAsaas: string | null;
  classificacao: ClassificacaoDaRodada;
}

export interface BaixaDaRodada extends ItemRodadaConferencia {
  pagoEm: string; // data enviada à conciliação (a que o cliente pagou)
  valorPago: number; // centavos enviados à conciliação
}

export interface RodadaConferenciaAsaas {
  dia: string;
  origem: OrigemRodada;
  disparadaPor: string | null; // usuário do "Rodar agora"
  iniciadaEm: string;
  concluidaEm: string;
  ambiente: 'simulado' | 'sandbox' | 'producao';
  lidas: { total: number; vencidas: number; venceHoje: number; aVencer: number };
  baixadas: BaixaDaRodada[]; // pagas no Asaas, enviadas à conciliação do webhook
  naoBaixadas: (ItemRodadaConferencia & { motivo: string })[]; // pagas lá, mas a baixa não foi enfileirada
  divergencias: ItemRodadaConferencia[]; // ficam para o operador
  divergenciasNovas: number; // não estavam na rodada anterior
  semLeitura: { faturaId: string; asaasChargeId: string; erro: string }[];
}

@Injectable()
export class ConferenciaAsaasAutomaticaService {
  private readonly logger = new Logger(ConferenciaAsaasAutomaticaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conferencia: ConferenciaAsaasService,
    private readonly notificacao: NotificacaoService,
    @InjectQueue(QUEUE_NAMES.CONFERENCIA_ASAAS)
    private readonly fila: Queue,
  ) {}

  // O agendamento SÓ enfileira (Regra 4) — no mesmo padrão do cron da régua.
  @Cron(CRON_CONFERENCIA, { timeZone: FUSO_NEGOCIO })
  async cronConferencia(): Promise<void> {
    await this.fila.add(
      'rodar',
      { origem: 'agendada' } satisfies JobRodadaConferencia,
      { jobId: jobIdRodadaDoDia(dataHojeBrasil()), removeOnComplete: true, removeOnFail: 50 },
    );
    this.logger.log('[cron] conferência automática Asaas × sistema enfileirada');
  }

  // "Rodar agora" (tela): a MESMA rodada, enfileirada fora do horário.
  async rodarAgora(usuarioId: string): Promise<{ enfileirado: true; jobId: string }> {
    const jobId = `${jobIdRodadaDoDia(dataHojeBrasil())}-manual-${Date.now()}`;
    await this.fila.add('rodar', { origem: 'manual', usuarioId } satisfies JobRodadaConferencia, { jobId, removeOnComplete: true, removeOnFail: 50 });
    return { enfileirado: true, jobId };
  }

  // O trabalho (worker): conferir tudo em aberto, baixar só o que está pago no
  // Asaas, registrar a rodada e avisar.
  async rodar(job: JobRodadaConferencia): Promise<RodadaConferenciaAsaas> {
    const iniciadaEm = new Date().toISOString();
    const dia = dataHojeBrasil();
    const conf = await this.conferencia.conferir(undefined, null, { semCache: true });

    const lidas = { total: conf.total, vencidas: 0, venceHoje: 0, aVencer: 0 };
    const baixadas: BaixaDaRodada[] = [];
    const naoBaixadas: RodadaConferenciaAsaas['naoBaixadas'] = [];
    const divergencias: ItemRodadaConferencia[] = [];

    for (const linha of conf.linhas) {
      const item = itemDaLinha(linha, conf.hoje);
      if (item.situacao === 'vencida') lidas.vencidas++;
      else if (item.situacao === 'vence_hoje') lidas.venceHoje++;
      else lidas.aVencer++;

      const decisao = decidirConferenciaAutomatica({
        classificacao: linha.classificacao,
        valorPagoAqui: linha.valorPagoAqui,
        valorPagoAsaas: linha.asaas?.valor ?? null,
      });
      if (decisao === 'ok') continue;
      if (decisao === 'divergencia') {
        divergencias.push(item);
        continue;
      }
      if (decisao === 'pago_a_menor_ja_registrado') {
        divergencias.push({ ...item, classificacao: 'pago_a_menor_ja_registrado' });
        continue;
      }
      // decisao === 'baixar'
      if (conf.ambiente === 'simulado') {
        naoBaixadas.push({ ...item, motivo: 'Asaas em modo simulado — nada é baixado' });
        continue;
      }
      try {
        const r = await this.conferencia.reconciliar(linha.faturaId, { jobId: jobIdConciliacaoAutomatica(dia, linha.faturaId) });
        baixadas.push({ ...item, pagoEm: r.job.paymentDate, valorPago: r.job.valor });
      } catch (e) {
        // Entre a leitura e a releitura ao vivo o Asaas pode ter mudado, ou a
        // fatura ter sido baixada pelo webhook: não baixa, registra o porquê.
        naoBaixadas.push({ ...item, motivo: motivoDoErro(e) });
      }
    }

    const anterior = await this.ultimaRodada();
    const novas = divergenciasNovas(divergencias, anterior?.divergencias ?? null);

    const rodada: RodadaConferenciaAsaas = {
      dia,
      origem: job.origem,
      disparadaPor: job.usuarioId ?? null,
      iniciadaEm,
      concluidaEm: new Date().toISOString(),
      ambiente: conf.ambiente,
      lidas,
      baixadas,
      naoBaixadas,
      divergencias,
      divergenciasNovas: novas.length,
      semLeitura: conf.falhas,
    };

    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId: job.usuarioId ?? null,
        acao: ACAO_LOG_CONFERENCIA,
        entidade: ENTIDADE_LOG_CONFERENCIA,
        entidadeId: dia,
        depois: rodada as unknown as Prisma.InputJsonValue,
      },
    });
    await this.avisar(rodada);
    this.logger.log(
      `conferência automática: ${lidas.total} lida(s), ${baixadas.length} baixada(s), ${divergencias.length} divergência(s) (${novas.length} nova(s)), ${conf.falhas.length} sem leitura`,
    );
    return rodada;
  }

  // Última rodada registrada (ou nenhuma).
  async ultimaRodada(): Promise<RodadaConferenciaAsaas | null> {
    const log = await this.prisma.db.logAuditoria.findFirst({
      where: { acao: ACAO_LOG_CONFERENCIA, entidade: ENTIDADE_LOG_CONFERENCIA },
      orderBy: { createdAt: 'desc' },
      select: { depois: true },
    });
    return (log?.depois as unknown as RodadaConferenciaAsaas | null) ?? null;
  }

  // Para a tela: a última rodada (com a situação ATUAL das faturas que ela
  // mandou baixar — a baixa é do worker da conciliação) e um resumo das anteriores.
  async painel(limite = 7) {
    const logs = await this.prisma.db.logAuditoria.findMany({
      where: { acao: ACAO_LOG_CONFERENCIA, entidade: ENTIDADE_LOG_CONFERENCIA },
      orderBy: { createdAt: 'desc' },
      take: limite + 1,
      select: { depois: true },
    });
    const rodadas = logs.map((l) => l.depois as unknown as RodadaConferenciaAsaas).filter(Boolean);
    const ultima = rodadas[0] ?? null;
    let baixadasAgora: Record<string, 'baixada' | 'aguardando_conciliacao'> = {};
    if (ultima && ultima.baixadas.length) {
      const faturas = await this.prisma.db.fatura.findMany({
        where: { id: { in: ultima.baixadas.map((b) => b.faturaId) } },
        select: { id: true, status: true },
      });
      baixadasAgora = Object.fromEntries(
        faturas.map((f) => [f.id, f.status === 'PAGA' || f.status === 'PAGA_EM_ATRASO' ? 'baixada' : 'aguardando_conciliacao']),
      );
    }
    return {
      horario: ROTULO_HORARIO_CONFERENCIA,
      ultima: ultima
        ? { ...ultima, baixadas: ultima.baixadas.map((b) => ({ ...b, situacaoAgora: baixadasAgora[b.faturaId] ?? 'aguardando_conciliacao' })) }
        : null,
      anteriores: rodadas.slice(1, limite + 1).map((r) => ({
        dia: r.dia,
        origem: r.origem,
        concluidaEm: r.concluidaEm,
        lidas: r.lidas.total,
        baixadas: r.baixadas.length,
        divergencias: r.divergencias.length,
        semLeitura: r.semLeitura.length,
      })),
    };
  }

  // Aviso no sino (área Carteira e cobrança) — PROVISÓRIO (doc 02 §27.9.1): quando
  // baixou alguma fatura, quando apareceu divergência que não estava na rodada
  // anterior, quando a baixa não pôde ser enfileirada ou quando faltou leitura.
  private async avisar(r: RodadaConferenciaAsaas): Promise<void> {
    // Sem chave do Asaas (dev): a rodada fica registrada, mas não toca o sino.
    if (r.ambiente === 'simulado') return;
    const problema = r.naoBaixadas.length > 0 || r.semLeitura.length > 0;
    if (!r.baixadas.length && !r.divergenciasNovas && !problema) return;
    const partes: string[] = [`Leu ${r.lidas.total} ${r.lidas.total === 1 ? 'fatura em aberto' : 'faturas em aberto'} no Asaas.`];
    if (r.baixadas.length) {
      partes.push(
        `Pagas lá e baixadas aqui: ${r.baixadas.map((b) => `${b.titular} (fatura ${b.numero}, ${formatCurrency(b.valorPago)})`).join('; ')}.`,
      );
    }
    if (r.divergencias.length) {
      partes.push(`Para olhar: ${r.divergencias.length}${r.divergenciasNovas ? ` (${r.divergenciasNovas} ${r.divergenciasNovas === 1 ? 'nova' : 'novas'})` : ''}.`);
    }
    if (r.naoBaixadas.length) partes.push(`Pagas lá, mas não baixadas: ${r.naoBaixadas.length}.`);
    if (r.semLeitura.length) partes.push(`Não deu para ler: ${r.semLeitura.length}.`);
    const titulo = r.baixadas.length
      ? `Conferência com o Asaas: ${r.baixadas.length} ${r.baixadas.length === 1 ? 'fatura paga lá foi baixada' : 'faturas pagas lá foram baixadas'} aqui`
      : r.divergenciasNovas
        ? `Conferência com o Asaas: ${r.divergenciasNovas} ${r.divergenciasNovas === 1 ? 'divergência nova' : 'divergências novas'} para olhar`
        : 'Conferência com o Asaas: rodada incompleta';
    await this.notificacao.emitir({
      titulo,
      corpo: partes.join(' '),
      rota: ROTA_CONFERENCIA,
      tipo: problema && !r.baixadas.length ? 'FALHA' : 'COBRANCA',
      area: 'CARTEIRA_COBRANCA',
    });
  }
}

function itemDaLinha(l: LinhaConferenciaAsaas, hoje: string): ItemRodadaConferencia {
  const s = situacaoFaturaRuntime(l.statusAqui, l.vencimentoAqui, hoje);
  return {
    faturaId: l.faturaId,
    numero: l.numero,
    titularId: l.titularId,
    titular: l.titular,
    vencimento: l.vencimentoAqui,
    situacao: s === 'vencida' ? 'vencida' : s === 'vence_hoje' ? 'vence_hoje' : 'a_vencer',
    valorAqui: l.valorAqui,
    asaasChargeId: l.asaasChargeId,
    statusAsaas: l.asaas?.status ?? null,
    valorAsaas: l.asaas?.valor ?? null,
    dataPagamentoAsaas: l.asaas?.dataPagamento ?? null,
    classificacao: l.classificacao,
  };
}

function motivoDoErro(e: unknown): string {
  const resp = (e as { response?: { mensagem?: string } })?.response;
  if (resp?.mensagem) return resp.mensagem;
  return e instanceof Error ? e.message : String(e);
}
