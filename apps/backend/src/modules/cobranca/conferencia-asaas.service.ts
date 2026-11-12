import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  classificarConferenciaAsaas,
  contarClassificacoes,
  dataCalendarioUTC,
  dataHojeBrasil,
  estadoFaturaVisao,
  inicioDiaUTC,
  somarDiasISO,
  type ClassificacaoConferenciaAsaas,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasLeituraService, type CobrancaAsaasLida } from '../asaas/asaas-leitura.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { eventoConciliacaoDe, type WebhookPagamento } from './fatura.service';

// Conferência "Asaas × sistema" (doc 02 §27.9, 12/11/2026): as faturas em
// aberto AQUI (ABERTA/FECHADA com cobrança emitida) lidas uma a uma no Asaas,
// lado a lado, com a divergência classificada em @azit/utils. Só leitura por
// padrão — o único efeito possível é `reconciliar`, e ele não baixa nada: enfileira
// o MESMO job `conciliar` que o webhook geraria (Regra 4: nada síncrono; Regra
// 1: Asaas executa, Azit controla — nada é alterado no Asaas).

export interface CobrancaAsaasConferida {
  id: string;
  status: string;
  vencimento: string; // YYYY-MM-DD
  valor: number; // centavos (value do Asaas)
  valorOriginal: number | null; // centavos — originalValue, quando o Asaas alterou o valor
  dataPagamento: string | null; // clientPaymentDate ?? paymentDate ?? confirmedDate
  deleted: boolean;
  invoiceUrl: string | null;
}

export interface LinhaConferenciaAsaas {
  faturaId: string;
  numero: number;
  contaId: string;
  titularId: string;
  titular: string;
  statusAqui: string; // ABERTA | FECHADA (o que está gravado)
  situacaoAqui: 'vencida' | 'a_vencer'; // runtime (Regra 7), pelo vencimento × hoje
  vencimentoAqui: string;
  valorAqui: number; // centavos
  asaasChargeId: string;
  asaas: CobrancaAsaasConferida | null; // null = 404 no Asaas
  classificacao: ClassificacaoConferenciaAsaas;
}

export interface ConferenciaAsaas {
  periodo: { de: string | null; ate: string };
  hoje: string;
  consultadoEm: string; // ISO — instante da leitura (as linhas podem vir do cache curto)
  ambiente: 'simulado' | 'sandbox' | 'producao';
  total: number;
  porClassificacao: Record<ClassificacaoConferenciaAsaas, number>;
  falhas: { faturaId: string; asaasChargeId: string; erro: string }[]; // cobranças que não deu para ler
  linhas: LinhaConferenciaAsaas[];
}

// Cache curto da leitura: a tela abre a conferência, o operador reconcilia uma
// linha e a lista recarrega — sem bater de novo no Asaas por 42 cobranças.
const CACHE_MS = 60_000;
// Lotes pequenos: entre um lote e outro o serviço cede o loop; dentro do lote o
// `requisicao` do AsaasLeituraService já compassa (~4/s) e espera no 429.
const TAMANHO_LOTE = 5;

const STATUS_EM_ABERTO_AQUI = ['ABERTA', 'FECHADA'] as const;

@Injectable()
export class ConferenciaAsaasService {
  private readonly logger = new Logger(ConferenciaAsaasService.name);
  private readonly cache = new Map<string, { lida: CobrancaAsaasLida | null; em: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasLeitura: AsaasLeituraService,
    @InjectQueue(QUEUE_NAMES.PAGAMENTO_RECEBIDO)
    private readonly filaRecebido: Queue,
  ) {}

  // Faturas em aberto com cobrança, vencimento em [de, ate]. Sem `de`: desde o
  // início; sem `ate`: até ontem (tudo que está VENCIDO hoje, fuso Brasil).
  async conferir(de?: string, ate?: string): Promise<ConferenciaAsaas> {
    const hoje = dataHojeBrasil();
    const fim = ate ?? somarDiasISO(hoje, -1);
    const faturas = await this.prisma.db.fatura.findMany({
      where: {
        deletedAt: null,
        status: { in: [...STATUS_EM_ABERTO_AQUI] },
        asaasChargeId: { not: null },
        dataVencimento: { ...(de ? { gte: inicioDiaUTC(de) } : {}), lt: inicioDiaUTC(somarDiasISO(fim, 1)) },
      },
      orderBy: [{ dataVencimento: 'asc' }, { numero: 'asc' }],
      select: {
        id: true,
        numero: true,
        contaId: true,
        status: true,
        dataVencimento: true,
        valorTotal: true,
        asaasChargeId: true,
        conta: { select: { titularId: true, titular: { select: { nome: true } } } },
      },
    });

    const linhas: LinhaConferenciaAsaas[] = [];
    const falhas: ConferenciaAsaas['falhas'] = [];
    for (let i = 0; i < faturas.length; i += TAMANHO_LOTE) {
      const lote = faturas.slice(i, i + TAMANHO_LOTE);
      for (const f of lote) {
        const chargeId = f.asaasChargeId as string;
        let lida: CobrancaAsaasLida | null;
        try {
          lida = await this.lerComCache(chargeId);
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Conferência Asaas: não li a cobrança ${chargeId} da fatura ${f.id}: ${erro}`);
          falhas.push({ faturaId: f.id, asaasChargeId: chargeId, erro });
          continue;
        }
        const vencimentoAqui = dataCalendarioUTC(f.dataVencimento);
        const valorAqui = Math.round(Number(f.valorTotal.toString()) * 100);
        const estado = estadoFaturaVisao(f.status, vencimentoAqui, hoje);
        linhas.push({
          faturaId: f.id,
          numero: f.numero,
          contaId: f.contaId,
          titularId: f.conta.titularId,
          titular: f.conta.titular.nome,
          statusAqui: f.status,
          situacaoAqui: estado === 'vencida' ? 'vencida' : 'a_vencer',
          vencimentoAqui,
          valorAqui,
          asaasChargeId: chargeId,
          asaas: lida ? resumirCobranca(lida) : null,
          classificacao: classificarConferenciaAsaas({ vencimento: vencimentoAqui, valor: valorAqui }, lida),
        });
      }
      if (i + TAMANHO_LOTE < faturas.length) await new Promise((r) => setImmediate(r));
    }

    return {
      periodo: { de: de ?? null, ate: fim },
      hoje,
      consultadoEm: new Date().toISOString(),
      ambiente: this.asaasLeitura.ambiente,
      total: linhas.length,
      porClassificacao: contarClassificacoes(linhas),
      falhas,
      linhas,
    };
  }

  // Reconciliar UMA fatura: lê a cobrança AO VIVO (sem cache — é ação), exige
  // `paga_no_asaas` e enfileira o job do webhook. Devolve o payload enfileirado
  // para o operador (e o teste) verem exatamente o que vai conciliar.
  async reconciliar(faturaId: string): Promise<{ enfileirado: true; statusAsaas: string; job: WebhookPagamento }> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId, deletedAt: null },
      select: { id: true, status: true, asaasChargeId: true, dataVencimento: true, valorTotal: true },
    });
    if (!fatura) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    if (!(STATUS_EM_ABERTO_AQUI as readonly string[]).includes(fatura.status)) {
      throw new UnprocessableEntityException({ erro: 'fatura_nao_aberta', mensagem: `A fatura não está em aberto no sistema (${fatura.status})` });
    }
    if (!fatura.asaasChargeId) throw new UnprocessableEntityException({ erro: 'sem_cobranca', mensagem: 'Esta fatura não tem cobrança no Asaas' });
    if (this.asaasLeitura.ambiente === 'simulado') {
      throw new UnprocessableEntityException({ erro: 'asaas_simulado', mensagem: 'Asaas em modo simulado — não há o que reconciliar' });
    }

    const lida = await this.asaasLeitura.lerCobranca(fatura.asaasChargeId);
    this.cache.delete(fatura.asaasChargeId);
    const classificacao = classificarConferenciaAsaas(
      { vencimento: dataCalendarioUTC(fatura.dataVencimento), valor: Math.round(Number(fatura.valorTotal.toString()) * 100) },
      lida,
    );
    if (classificacao !== 'paga_no_asaas' || !lida) {
      throw new UnprocessableEntityException({
        erro: 'nao_paga_no_asaas',
        mensagem: 'Só se reconcilia o que o Asaas registra como pago',
        classificacao,
        statusAsaas: lida?.status ?? null,
      });
    }
    const job = eventoConciliacaoDe(fatura.id, lida);
    await this.filaRecebido.add('conciliar', job);
    this.logger.log(`Conferência Asaas: fatura ${fatura.id} enfileirada para conciliar (Asaas ${lida.status}, pago em ${job.paymentDate})`);
    return { enfileirado: true, statusAsaas: lida.status, job };
  }

  private async lerComCache(chargeId: string): Promise<CobrancaAsaasLida | null> {
    const agora = Date.now();
    const c = this.cache.get(chargeId);
    if (c && agora - c.em < CACHE_MS) return c.lida;
    const lida = await this.asaasLeitura.lerCobranca(chargeId);
    this.cache.set(chargeId, { lida, em: agora });
    return lida;
  }
}

function resumirCobranca(c: CobrancaAsaasLida): CobrancaAsaasConferida {
  return {
    id: c.id,
    status: c.status,
    vencimento: c.dueDate,
    valor: Math.round(Number(c.value) * 100),
    valorOriginal: c.originalValue === null || c.originalValue === undefined ? null : Math.round(Number(c.originalValue) * 100),
    dataPagamento: c.clientPaymentDate ?? c.paymentDate ?? c.confirmedDate ?? null,
    deleted: !!c.deleted,
    invoiceUrl: c.invoiceUrl ?? null,
  };
}
