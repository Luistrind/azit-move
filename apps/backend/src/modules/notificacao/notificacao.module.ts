import { Module } from '@nestjs/common';
import { NotificacaoController } from './notificacao.controller';
import { NotificacaoService } from './notificacao.service';

// Notificações ao operador (doc 02 §20 passo 13): marcos do pós-contrato no
// sino do topo — contrato assinado, cobrança da entrada gerada, entrada paga.
@Module({
  controllers: [NotificacaoController],
  providers: [NotificacaoService],
  exports: [NotificacaoService],
})
export class NotificacaoModule {}
