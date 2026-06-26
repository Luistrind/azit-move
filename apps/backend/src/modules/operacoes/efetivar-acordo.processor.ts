import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { RenegociacaoService } from './renegociacao.service';

// 6.4 — Efetivação da renegociação ao receber a entrada (Gatilho 6). Webhook
// nunca síncrono: a novação roda no worker.
@Processor(QUEUE_NAMES.EFETIVAR_ACORDO)
export class EfetivarAcordoProcessor extends WorkerHost {
  private readonly logger = new Logger(EfetivarAcordoProcessor.name);
  constructor(private readonly renegociacao: RenegociacaoService) {
    super();
  }
  async process(job: Job<{ acordoId: string; paymentDate: string }>) {
    const r = await this.renegociacao.efetivar(job.data.acordoId, job.data.paymentDate);
    this.logger.log(`efetivar acordo ${job.data.acordoId}: ${r.resultado}`);
    return r;
  }
}
