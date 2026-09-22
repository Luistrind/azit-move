import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { MigracaoLegadoService } from './migracao-legado.service';

// Leitura do Asaas em segundo plano (doc 02 §26.6, F1): são centenas de
// chamadas por coleta — o operador dispara pela tela e acompanha o progresso.
@Processor(QUEUE_NAMES.COLETA_LEGADO)
export class ColetaLegadoProcessor extends WorkerHost {
  private readonly logger = new Logger(ColetaLegadoProcessor.name);
  constructor(private readonly migracao: MigracaoLegadoService) {
    super();
  }
  async process(job: Job<{ coletaId: string }>) {
    const r = await this.migracao.executarColeta(job.data.coletaId);
    this.logger.log(`coleta ${job.data.coletaId}: ${r.resultado}`);
    return r;
  }
}
