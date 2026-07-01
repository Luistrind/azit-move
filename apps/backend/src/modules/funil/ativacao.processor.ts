import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { FormalizacaoService } from './formalizacao.service';

// Processa o webhook PAYMENT_RECEIVED da ENTRADA (externalReference ativacao:<id>):
// "dia zero" → gera o cronograma e ativa o pacote de contratos (Regra 4: assíncrono).
@Processor(QUEUE_NAMES.ATIVAR_CONTRATO)
export class AtivacaoProcessor extends WorkerHost {
  private readonly logger = new Logger(AtivacaoProcessor.name);
  constructor(private readonly formalizacao: FormalizacaoService) {
    super();
  }
  async process(job: Job<{ contratoId: string }>) {
    const r = await this.formalizacao.ativarPacotePorPagamento(job.data.contratoId);
    this.logger.log(`ativacao ${job.data.contratoId}: ${r.contratosAtivados} contrato(s) ativado(s)`);
    return r;
  }
}
