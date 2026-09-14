import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { AssistenteAnaliseService } from './assistente-analise.service';
import { AnaliseService } from './analise.service';

// Resumo do assistente de análise (IA — 14/09) roda no WORKER: a chamada ao
// Claude com pesquisa na internet leva minutos e nunca pode segurar a tela.
// Job 'consultar' (decisão Luís 14/09 — consultas automáticas, sem botão)
// roda as 7 consultas da 2ª camada e dispara o resumo ao final; 'gerar' só o
// resumo. Falha grava status na própria análise (a tela oferece regenerar).
@Processor(QUEUE_NAMES.RESUMO_ANALISE, { concurrency: 1 })
export class ResumoAnaliseProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumoAnaliseProcessor.name);
  constructor(
    private readonly assistente: AssistenteAnaliseService,
    private readonly analise: AnaliseService,
  ) {
    super();
  }
  async process(job: Job<{ analiseId: string }>) {
    if (job.name === 'consultar') {
      await this.analise.consultarBiroCamada2Todas(job.data.analiseId, {});
      this.logger.log(`consultas automáticas da análise ${job.data.analiseId} concluídas — resumo enfileirado`);
      return { resultado: 'consultas_concluidas' };
    }
    const r = await this.assistente.gerar(job.data.analiseId);
    this.logger.log(`resumo IA ${job.data.analiseId}: ${r.resultado}`);
    return r;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ analiseId: string }> | undefined, err: Error) {
    this.logger.error(`RESUMO IA FALHOU (${job?.data?.analiseId ?? '?'}): ${err.message}`);
  }
}
