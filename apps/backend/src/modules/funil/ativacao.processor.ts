import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { FormalizacaoService } from './formalizacao.service';
import { NotificacaoService } from '../notificacao/notificacao.service';

// Processa o webhook PAYMENT_RECEIVED da ENTRADA (externalReference ativacao:<id>):
// "dia zero" → gera o cronograma, materializa a entrada paga e ativa o pacote de
// contratos (Regra 4: assíncrono).
@Processor(QUEUE_NAMES.ATIVAR_CONTRATO)
export class AtivacaoProcessor extends WorkerHost {
  private readonly logger = new Logger(AtivacaoProcessor.name);
  constructor(
    private readonly formalizacao: FormalizacaoService,
    private readonly notificacao: NotificacaoService,
  ) {
    super();
  }
  async process(job: Job<{ contratoId: string; paymentDate?: string }>) {
    const r = await this.formalizacao.ativarPacotePorPagamento(job.data.contratoId, job.data.paymentDate);
    this.logger.log(`ativacao ${job.data.contratoId}: ${r.contratosAtivados} contrato(s) ativado(s)`);
    return r;
  }

  // Decisão 2026-08-16 (doc 02 §4-A.3): falha de ativação NUNCA morre muda no
  // Redis — o caso real ("pagou e nada aconteceu") só foi diagnosticado escavando
  // a fila. Log + notificação no sino com o motivo.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ contratoId: string }> | undefined, err: Error) {
    const contratoId = job?.data?.contratoId ?? 'desconhecido';
    const motivo = (err as Error & { response?: { mensagem?: string } })?.response?.mensagem ?? err.message;
    this.logger.error(`ATIVACAO FALHOU (contrato ${contratoId}): ${motivo}`);
    await this.notificacao
      .emitir(
        `Ativação de contrato FALHOU — entrada paga sem cronograma`,
        `Motivo: ${motivo}. Corrija a causa e reprocesse o pagamento da entrada.`,
        `/contratos/${contratoId}`,
      )
      .catch(() => undefined);
  }
}
