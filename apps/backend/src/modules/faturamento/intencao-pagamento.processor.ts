import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { formatCurrency } from '@azit/utils';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { BaixaContaService } from './baixa-conta.service';
import { IntencaoPagamentoService, type JobBaixaIntencao, type JobCancelarPix } from './intencao-pagamento.service';

// Fila do Pix sob demanda (doc 02 §32.4-A). Três jobs:
//   · 'baixar'   — Pix de uma intenção foi pago (webhook → 202 → aqui, Regra 4):
//                  aplica pela conta, na data do pagamento;
//   · 'expirar'  — virada do dia: expira as intenções ativas e cancela os Pix;
//   · 'cancelar' — o cliente pediu outro valor: o Pix da intenção substituída é
//                  cancelado no gateway aqui, fora da resposta ao cliente.
@Processor(QUEUE_NAMES.INTENCAO_PAGAMENTO)
export class IntencaoPagamentoProcessor extends WorkerHost {
  private readonly logger = new Logger(IntencaoPagamentoProcessor.name);

  constructor(
    private readonly intencao: IntencaoPagamentoService,
    private readonly baixa: BaixaContaService,
    private readonly notificacao: NotificacaoService,
  ) {
    super();
  }

  async process(job: Job<JobBaixaIntencao | JobCancelarPix | Record<string, never>>) {
    if (job.name === 'expirar') {
      const r = await this.intencao.expirarVencidas();
      this.logger.log(`virada do dia: ${r.expiradas} intenção(ões) expirada(s); ${r.pagasEncontradas} já paga(s) no gateway`);
      return r;
    }
    if (job.name === 'cancelar') {
      const r = await this.intencao.cancelarSubstituida(job.data as JobCancelarPix);
      this.logger.log(`cancelamento do Pix da intenção ${(job.data as JobCancelarPix).intencaoId}: ${r.resultado}`);
      return r;
    }
    if (job.name === 'baixar') {
      const r = await this.baixa.aplicarPagamentoDeIntencao(job.data as JobBaixaIntencao);
      this.logger.log(`baixa da intenção ${(job.data as JobBaixaIntencao).intencaoId}: ${r.resultado}`);
      return r;
    }
    throw new Error(`Job desconhecido na fila de intenção de pagamento: ${job.name}`);
  }

  // Dinheiro recebido que não conseguimos aplicar NÃO pode ficar só no Redis:
  // esgotadas as tentativas, a carteira é avisada.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<JobBaixaIntencao> | undefined, err: Error) {
    // Só a BAIXA avisa a carteira: cancelamento que esgotou as tentativas não envolve dinheiro parado (e o Pix pago mesmo assim é aceito).
    if (!job || job.name !== 'baixar') return;
    const tentativas = job.opts?.attempts ?? 1;
    if ((job.attemptsMade ?? tentativas) < tentativas) return;
    this.logger.error(`BAIXA DE PIX FALHOU (intenção ${job.data.intencaoId}, pagamento ${job.data.pagamentoId}): ${err.message}`);
    await this.notificacao
      .emitir({
        titulo: 'Pix recebido e NÃO aplicado à conta',
        corpo: `Pagamento ${job.data.pagamentoId} de ${formatCurrency(job.data.valor)} — todas as tentativas de baixa falharam. Motivo: ${err.message}`,
        rota: '/regua',
        tipo: 'FALHA',
        area: 'CARTEIRA_COBRANCA',
      })
      .catch((e) => this.logger.error(`Falha ao notificar: ${(e as Error).message}`));
  }
}
