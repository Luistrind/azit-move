import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { FaturaService, WebhookPagamento } from './fatura.service';

// Processadores BullMQ (Regra nº 4: webhook enfileira, worker processa).

@Processor(QUEUE_NAMES.PAGAMENTO_RECEBIDO)
export class PagamentoRecebidoProcessor extends WorkerHost {
  private readonly logger = new Logger(PagamentoRecebidoProcessor.name);
  constructor(private readonly fatura: FaturaService) {
    super();
  }
  async process(job: Job<WebhookPagamento>) {
    const r = await this.fatura.conciliarPagamento(job.data);
    this.logger.log(`conciliar ${job.data.faturaId}: ${r.resultado}`);
    return r;
  }
}

@Processor(QUEUE_NAMES.PAGAMENTO_VENCIDO)
export class PagamentoVencidoProcessor extends WorkerHost {
  constructor(private readonly fatura: FaturaService) {
    super();
  }
  async process(job: Job<{ faturaId: string }>) {
    return this.fatura.marcarVencida(job.data.faturaId);
  }
}

@Processor(QUEUE_NAMES.FECHAR_FATURA)
export class FecharFaturaProcessor extends WorkerHost {
  constructor(private readonly fatura: FaturaService) {
    super();
  }
  async process() {
    return this.fatura.fechar();
  }
}

@Processor(QUEUE_NAMES.GERAR_COBRANCA_ASAAS)
export class GerarCobrancaProcessor extends WorkerHost {
  private readonly logger = new Logger(GerarCobrancaProcessor.name);
  constructor(
    private readonly fatura: FaturaService,
    private readonly notificacao: NotificacaoService,
  ) {
    super();
  }
  async process(job: Job<{ faturaId: string }>) {
    await this.fatura.gerarCobranca(job.data.faturaId);
  }

  // Falha DEFINITIVA (esgotou os retries) vira alerta no sino (correção 08/09:
  // a cobrança morria só no Redis e a fatura ficava sem boleto em silêncio).
  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ faturaId: string }> | undefined, err: Error) {
    const tentativas = job?.opts?.attempts ?? 1;
    const feitas = job?.attemptsMade ?? tentativas;
    this.logger.error(`GERAR COBRANCA FALHOU (fatura ${job?.data?.faturaId ?? '?'}, tentativa ${feitas}/${tentativas}): ${err.message}`);
    if (feitas < tentativas) return; // ainda vai tentar de novo
    await this.notificacao
      .emitir({
        titulo: 'Cobrança da fatura NÃO foi criada no Asaas',
        corpo: `Fatura ${job?.data?.faturaId ?? '?'} — todas as tentativas falharam. Motivo: ${err.message}`,
        rota: '/regua',
        tipo: 'FALHA',
        area: 'CARTEIRA_COBRANCA',
      })
      .catch((e) => this.logger.error(`Falha ao notificar: ${(e as Error).message}`));
  }
}

@Processor(QUEUE_NAMES.NOTIFICAR_CLIENTE)
export class NotificarClienteProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificarClienteProcessor.name);
  async process(job: Job<{ faturaId: string; mensagem?: string }>) {
    // Z-API stub (modo simulado): apenas loga o que enviaria (item 4.8).
    this.logger.log(`[simulado] WhatsApp p/ fatura ${job.data.faturaId}`);
  }
}
