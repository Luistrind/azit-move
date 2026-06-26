import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
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
  constructor(private readonly fatura: FaturaService) {
    super();
  }
  async process(job: Job<{ faturaId: string }>) {
    await this.fatura.gerarCobranca(job.data.faturaId);
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
