import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { formatCurrency } from '@azit/utils';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { BaixaContaService } from './baixa-conta.service';
import { IntencaoPagamentoService, type JobBaixaIntencao, type JobCancelarPix, type JobIdentificarPix } from './intencao-pagamento.service';

// Fila do Pix sob demanda (doc 02 §32.4-A). Quatro jobs:
//   · 'identificar' — pagamento Pix avisado sem a referência da intenção (QR
//                  estático): descobre a intenção pelo id do Pix e enfileira 'baixar';
//   · 'baixar'   — Pix de uma intenção foi pago (webhook → 202 → aqui, Regra 4):
//                  aplica pela conta, na data do pagamento;
//   · 'expirar'  — virada do dia: expira as intenções ativas e cancela os Pix;
//   · 'cancelar' — um pagamento foi baixado na conta: o Pix das OUTRAS intenções
//                  ativas (que já não correspondem ao que se deve) é cancelado no
//                  gateway aqui. Gerar um Pix novo não cancela nada (regra 15/11).
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

  async process(job: Job<JobBaixaIntencao | JobCancelarPix | JobIdentificarPix | Record<string, never>>) {
    if (job.name === 'identificar') {
      const d = job.data as JobIdentificarPix;
      const r = await this.intencao.identificarPagamento(d);
      this.logger.log(`pagamento ${d.pagamentoId}: ${r.resultado}${r.intencaoId ? ` (intenção ${r.intencaoId})` : ''}`);
      return r;
    }
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
  async onFailed(job: Job<JobBaixaIntencao | JobIdentificarPix> | undefined, err: Error) {
    // Só o que envolve DINHEIRO RECEBIDO avisa a carteira: a baixa e a
    // identificação do pagamento de um QR (se ela não roda, a baixa nem começa).
    // Cancelamento que esgotou as tentativas não deixa dinheiro parado (e o Pix
    // pago mesmo assim é aceito).
    if (!job || (job.name !== 'baixar' && job.name !== 'identificar')) return;
    const tentativas = job.opts?.attempts ?? 1;
    if ((job.attemptsMade ?? tentativas) < tentativas) return;
    const etapa = job.name === 'identificar' ? 'de identificar de qual Pix ele veio' : 'de baixa';
    this.logger.error(`${job.name === 'identificar' ? 'IDENTIFICAÇÃO' : 'BAIXA'} DE PIX FALHOU (pagamento ${job.data.pagamentoId}): ${err.message}`);
    await this.notificacao
      .emitir({
        titulo: 'Pix recebido e NÃO aplicado à conta',
        corpo: `Pagamento ${job.data.pagamentoId} de ${formatCurrency(job.data.valor)} — todas as tentativas ${etapa} falharam. Motivo: ${err.message}`,
        rota: '/regua',
        tipo: 'FALHA',
        area: 'CARTEIRA_COBRANCA',
      })
      .catch((e) => this.logger.error(`Falha ao notificar: ${(e as Error).message}`));
  }
}
