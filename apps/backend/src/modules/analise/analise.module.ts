import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AprovacaoModule } from '../aprovacao/aprovacao.module';
import { BureauModule } from '../bureau/bureau.module';
import { QUEUE_NAMES } from '../queues/queues.module';
import { AnaliseController } from './analise.controller';
import { AnaliseService } from './analise.service';
import { AssistenteAnaliseService } from './assistente-analise.service';
import { ResumoAnaliseProcessor } from './resumo-analise.processor';

// Análise de Cadastro (doc 02 §14) — módulo do domínio 4 da taxonomia oficial.
// Desde 14/09 inclui o assistente de análise (IA): resumo cadastral automático
// gerado em fila a partir das consultas de birô + documentos anexados.
@Module({
  imports: [
    AprovacaoModule,
    BureauModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.RESUMO_ANALISE }),
  ],
  controllers: [AnaliseController],
  providers: [AnaliseService, AssistenteAnaliseService, ResumoAnaliseProcessor],
  exports: [AnaliseService],
})
export class AnaliseModule {}
