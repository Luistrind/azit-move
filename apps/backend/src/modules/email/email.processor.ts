import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { DadosJobEmail, EmailService, ResultadoJobEmail } from './email.service';
import { TRANSPORTE_EMAIL, TransporteEmail } from './transporte-email';

// Worker da fila `email` (doc 06 §12.3 item 3, §12.4). Ordem por job:
//   1. sem transporte configurado → termina como `nao_configurado` (sem retry);
//   2. gancho `antesDeEnviar` da origem → descarta se já não faz sentido
//      (pessoa já leu / já decidiu / solicitação encerrada — §12.3 item 2);
//   3. envia; gancho `enviado` grava o rastro.
// Falha lança → BullMQ tenta de novo (3×, espera crescente); na última, o
// evento `failed` grava o motivo na origem e avisa a área Configurações.
@Processor(QUEUE_NAMES.EMAIL, { concurrency: 2 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private avisouNaoConfigurado = false;

  constructor(
    private readonly email: EmailService,
    private readonly notificacao: NotificacaoService,
    @Inject(TRANSPORTE_EMAIL) private readonly transporte: TransporteEmail,
  ) {
    super();
  }

  async process(job: Job<DadosJobEmail, ResultadoJobEmail>): Promise<ResultadoJobEmail> {
    const { origem } = job.data;
    const ganchos = this.email.ganchos(origem.tipo);

    if (!this.transporte.configurado()) {
      if (!this.avisouNaoConfigurado) {
        this.avisouNaoConfigurado = true;
        this.logger.warn('E-mail não configurado neste ambiente — jobs da fila `email` terminam sem envio (aviso único)');
      }
      await ganchos?.naoEnviado?.(origem, 'email_nao_configurado', true);
      return { resultado: 'nao_configurado' };
    }

    const veredito = (await ganchos?.antesDeEnviar?.(origem)) ?? { ok: true as const };
    if (!veredito.ok) {
      await ganchos?.naoEnviado?.(origem, veredito.motivo, true);
      this.logger.log(`e-mail descartado (${origem.tipo}:${origem.id}): ${veredito.motivo}`);
      return { resultado: 'descartado', motivo: veredito.motivo };
    }

    const { idProvedor } = await this.transporte.enviar({ para: job.data.para, assunto: job.data.assunto, texto: job.data.texto, html: job.data.html });
    await ganchos?.enviado?.(origem, new Date(), idProvedor);
    this.logger.log(`e-mail enviado (${origem.tipo}:${origem.id}) para ${job.data.para}`);
    return { resultado: 'enviado', idProvedor };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<DadosJobEmail> | undefined, err: Error) {
    if (!job) return;
    const definitivo = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.error(`e-mail FALHOU (${job.data.origem.tipo}:${job.data.origem.id}, tentativa ${job.attemptsMade}${definitivo ? ', definitiva' : ''}): ${err.message}`);
    if (!definitivo) return;
    await this.registrarFalhaDefinitiva(job.data, err.message);
  }

  // Separado para ser testável sem o evento do worker.
  async registrarFalhaDefinitiva(dados: DadosJobEmail, motivo: string) {
    const ganchos = this.email.ganchos(dados.origem.tipo);
    await ganchos?.naoEnviado?.(dados.origem, motivo, true).catch((e: Error) => this.logger.error(`gancho naoEnviado falhou: ${e.message}`));
    // §12.3 item 3: falha de envio vira notificação de falha de sistema (área
    // Configurações), sem o conteúdo do e-mail — só destinatário, assunto e motivo.
    await this.notificacao.emitir({
      titulo: 'Falha ao enviar e-mail',
      corpo: `"${dados.assunto}" para ${dados.para} não saiu após as tentativas: ${motivo}`,
      rota: '/configuracoes/integracoes',
      tipo: 'FALHA',
      area: 'CONFIGURACOES',
    });
  }
}
