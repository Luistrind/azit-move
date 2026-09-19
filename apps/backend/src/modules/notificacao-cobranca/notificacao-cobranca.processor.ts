import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { NotificacaoCobrancaService } from './notificacao-cobranca.service';

// Fila das notificações do POP-COB-001 (doc 02 §23): varredura horária,
// envio (1 job por notificação, jobId idempotente) e status do webhook da
// Meta (Regra 4 — o webhook só enfileira).
@Processor(QUEUE_NAMES.NOTIFICACAO_COBRANCA)
export class NotificacaoCobrancaProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificacaoCobrancaProcessor.name);

  constructor(private readonly service: NotificacaoCobrancaService) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'varrer': {
        const r = await this.service.varrer(job.data ?? {});
        this.logger.log(`notificações POP: ${r.contratos} contrato(s), ${r.casosAbertos} caso(s) aberto(s), ${r.casosEncerrados} encerrado(s), ${r.enfileirados} envio(s)${r.retidas ? `, ${r.retidas} retida(s) sem credencial` : ''}`);
        return r;
      }
      case 'enviar':
        return this.service.enviar(job.data);
      case 'status-meta':
        return this.service.processarStatusMeta(job.data);
      default:
        this.logger.warn(`job desconhecido: ${job.name}`);
        return null;
    }
  }
}
