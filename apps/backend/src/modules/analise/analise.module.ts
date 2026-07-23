import { Module } from '@nestjs/common';
import { AprovacaoModule } from '../aprovacao/aprovacao.module';
import { AnaliseController } from './analise.controller';
import { AnaliseService } from './analise.service';

// Análise de Cadastro (doc 02 §14) — módulo do domínio 4 da taxonomia oficial.
@Module({
  imports: [AprovacaoModule],
  controllers: [AnaliseController],
  providers: [AnaliseService],
  exports: [AnaliseService],
})
export class AnaliseModule {}
