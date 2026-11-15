import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { BaixaContaService } from './baixa-conta.service';
import { ContaFaturaService } from './conta-fatura.service';
import { FaturamentoController } from './faturamento.controller';
import { GATEWAY_PIX } from './gateway-pix';
import { GatewayPixAsaas } from './gateway-pix-asaas';
import { IntencaoPagamentoProcessor } from './intencao-pagamento.processor';
import { IntencaoPagamentoService } from './intencao-pagamento.service';
import { PagamentoContaController } from './pagamento-conta.controller';
import { ParametrosFaturamentoService } from './parametros-faturamento.service';

// Fatura Azit F2 (doc 02 §32): parâmetros de faturamento, motor da conta,
// intenção de pagamento (Pix sob demanda) e baixa pela conta. O gateway entra
// pela interface GatewayPix — trocar de Asaas para outro emissor é trocar o
// `useClass` abaixo. Não importa o CobrancaModule (que importa este) — sem
// ciclo. Asaas, Prisma, Notificação e Integrações são módulos globais.
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.INTENCAO_PAGAMENTO })],
  controllers: [FaturamentoController, PagamentoContaController],
  providers: [
    ParametrosFaturamentoService,
    ContaFaturaService,
    IntencaoPagamentoService,
    BaixaContaService,
    IntencaoPagamentoProcessor,
    { provide: GATEWAY_PIX, useClass: GatewayPixAsaas },
  ],
  exports: [ParametrosFaturamentoService, ContaFaturaService, IntencaoPagamentoService, BaixaContaService, GATEWAY_PIX],
})
export class FaturamentoModule {}
