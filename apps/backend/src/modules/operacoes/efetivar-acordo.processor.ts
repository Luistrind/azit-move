import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { RenegociacaoService } from './renegociacao.service';

// 6.4 — Efetivação da renegociação ao receber a entrada (Gatilho 6). Webhook
// nunca síncrono: roda no worker. Job 'entrada-vencida' expira a proposta cuja
// entrada venceu sem pagamento (doc 02 §7.7, 2026-08-18).
@Processor(QUEUE_NAMES.EFETIVAR_ACORDO)
export class EfetivarAcordoProcessor extends WorkerHost {
  private readonly logger = new Logger(EfetivarAcordoProcessor.name);
  constructor(private readonly renegociacao: RenegociacaoService) {
    super();
  }
  async process(job: Job<{ acordoId: string; paymentDate?: string }>) {
    if (job.name === 'entrada-vencida') {
      return this.renegociacao.expirarPorEntradaVencida(job.data.acordoId);
    }
    const r = await this.renegociacao.efetivar(job.data.acordoId, job.data.paymentDate ?? '');
    this.logger.log(`efetivar acordo ${job.data.acordoId}: ${r.resultado}`);
    return r;
  }

  // Falha de job nunca morre muda (padrão 2026-08-16).
  @OnWorkerEvent('failed')
  onFailed(job: Job<{ acordoId: string }> | undefined, err: Error) {
    this.logger.error(`EFETIVACAO DE ACORDO FALHOU (${job?.data?.acordoId ?? '?'}, job ${job?.name ?? '?'}): ${err.message}`);
  }
}
