import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { FaturaService } from './fatura.service';
import { WebhookController } from './webhook.controller';
import { CobrancaController } from './cobranca.controller';
import {
  PagamentoRecebidoProcessor,
  PagamentoVencidoProcessor,
  FecharFaturaProcessor,
  GerarCobrancaProcessor,
  NotificarClienteProcessor,
} from './cobranca.processors';

// Bloco 4 — ciclo de cobrança: faturas, Asaas (simulado), webhook, conciliação.
// As filas já são registradas globalmente no QueuesModule; aqui só registramos os
// produtores que este módulo injeta (idempotente) e os processadores.
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.PAGAMENTO_RECEBIDO },
      { name: QUEUE_NAMES.PAGAMENTO_VENCIDO },
      { name: QUEUE_NAMES.FECHAR_FATURA },
      { name: QUEUE_NAMES.GERAR_COBRANCA_ASAAS },
      { name: QUEUE_NAMES.NOTIFICAR_CLIENTE },
      { name: QUEUE_NAMES.EFETIVAR_ACORDO },
      { name: QUEUE_NAMES.ATIVAR_CONTRATO },
    ),
  ],
  controllers: [WebhookController, CobrancaController],
  providers: [
    FaturaService,
    PagamentoRecebidoProcessor,
    PagamentoVencidoProcessor,
    FecharFaturaProcessor,
    GerarCobrancaProcessor,
    NotificarClienteProcessor,
  ],
  exports: [FaturaService],
})
export class CobrancaModule {}
