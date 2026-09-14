import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { AssistenteAnaliseService } from './assistente-analise.service';

// Resumo do assistente de análise (IA — 14/09) roda no WORKER: a chamada ao
// Claude com pesquisa na internet leva minutos e nunca pode segurar a tela.
// Falha grava status 'falha' na própria análise (a tela oferece regenerar).
@Processor(QUEUE_NAMES.RESUMO_ANALISE, { concurrency: 1 })
export class ResumoAnaliseProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumoAnaliseProcessor.name);
  constructor(private readonly assistente: AssistenteAnaliseService) {
    super();
  }
  async process(job: Job<{ analiseId: string }>) {
    const r = await this.assistente.gerar(job.data.analiseId);
    this.logger.log(`resumo IA ${job.data.analiseId}: ${r.resultado}`);
    return r;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ analiseId: string }> | undefined, err: Error) {
    this.logger.error(`RESUMO IA FALHOU (${job?.data?.analiseId ?? '?'}): ${err.message}`);
  }
}
