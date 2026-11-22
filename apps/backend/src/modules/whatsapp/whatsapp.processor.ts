import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { WhatsappEventosService } from './whatsapp-eventos.service';
import { WhatsappMensagensService } from './whatsapp-mensagens.service';

// Fila do WhatsApp (doc 02 §23.4 — Regra 4: o webhook só enfileira).
//   evento-meta    corpo recebido da Meta: situação de entrega + mensagens dos clientes
//   midia-entrada  baixa a mídia de uma mensagem recebida (o link da Meta expira)
export const JOB_EVENTO_META = 'evento-meta';
export const JOB_MIDIA_ENTRADA = 'midia-entrada';

// Jobs de outros assuntos do mesmo canal (lembretes, §28) se registram aqui
// para não haver dois consumidores disputando a mesma fila.
export type TratadorJobWhatsapp = (job: Job) => Promise<unknown>;

@Processor(QUEUE_NAMES.WHATSAPP)
export class WhatsappProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappProcessor.name);
  private readonly tratadores = new Map<string, TratadorJobWhatsapp>();

  constructor(
    private readonly eventos: WhatsappEventosService,
    private readonly mensagens: WhatsappMensagensService,
  ) {
    super();
  }

  registrarTratador(nome: string, tratador: TratadorJobWhatsapp) {
    this.tratadores.set(nome, tratador);
  }

  async process(job: Job) {
    switch (job.name) {
      case JOB_EVENTO_META:
        return this.eventos.processar(job.data);
      case JOB_MIDIA_ENTRADA:
        return this.mensagens.baixarMidia((job.data as { id: string }).id);
      default: {
        const tratador = this.tratadores.get(job.name);
        if (tratador) return tratador(job);
        this.logger.warn(`job desconhecido na fila do WhatsApp: ${job.name}`);
        return null;
      }
    }
  }
}
