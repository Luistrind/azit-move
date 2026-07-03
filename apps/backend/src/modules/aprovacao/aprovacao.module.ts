import { Global, Module } from '@nestjs/common';
import { AprovacaoService } from './aprovacao.service';
import { AprovacaoController } from './aprovacao.controller';

// Motor de aprovação (Doc 2 §7.9-A). Global: os módulos de domínio (crédito,
// operações) injetam o service para criar solicitações e registrar efetivadores.
@Global()
@Module({
  controllers: [AprovacaoController],
  providers: [AprovacaoService],
  exports: [AprovacaoService],
})
export class AprovacaoModule {}
