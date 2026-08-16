import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { AssinaturaService } from './assinatura.service';

// Processa os eventos da ZapSign FORA do ciclo do webhook (Regra 4).
@Processor(QUEUE_NAMES.ASSINATURA_EVENTO)
export class AssinaturaProcessor extends WorkerHost {
  private readonly logger = new Logger(AssinaturaProcessor.name);

  constructor(private readonly service: AssinaturaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      await this.service.processarEvento(job.data as Parameters<AssinaturaService['processarEvento']>[0]);
    } catch (e) {
      this.logger.error(`Evento de assinatura falhou (job ${job.id}): ${(e as Error).message}`);
      throw e; // BullMQ reprocessa
    }
  }
}
