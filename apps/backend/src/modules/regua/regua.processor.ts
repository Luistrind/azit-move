import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '../queues/queues.module';
import { ReguaService } from './regua.service';

// 5.3 — Job da régua: avança contratos pelos estágios e dispara as ações
// automáticas. Em prod é agendado (repeatable); a fila já existe (Bloco 0.7).
@Processor(QUEUE_NAMES.REGUA_STEP)
export class ReguaStepProcessor extends WorkerHost {
  private readonly logger = new Logger(ReguaStepProcessor.name);
  constructor(private readonly regua: ReguaService) {
    super();
  }
  async process() {
    const r = await this.regua.rodar();
    this.logger.log(
      `régua: ${r.faturasVencidas} vencidas, ${r.emRegua} em régua, ${r.notificados} notificados`,
    );
    return r;
  }
}
