import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { MigracaoLegadoService } from './migracao-legado.service';
import { ColetaLegadoProcessor } from './migracao-legado.processor';
import { LegadoConciliacaoService } from './legado-conciliacao.service';
import { MigracaoLegadoController } from './migracao-legado.controller';
import { LegadoMigracaoService } from './legado-migracao.service';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { FipeModule } from '../fipe/fipe.module';
import { CatalogoModule } from '../catalogo/catalogo.module';

// Migração do legado (doc 02 §26): bancada de conciliação dos clientes que já
// existem no Asaas. F1 = leitura + triagem + tela; o contrato só nasce na F3.
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.COLETA_LEGADO }), CobrancaModule, FipeModule, CatalogoModule],
  controllers: [MigracaoLegadoController],
  providers: [MigracaoLegadoService, LegadoConciliacaoService, LegadoMigracaoService, ColetaLegadoProcessor],
  exports: [MigracaoLegadoService],
})
export class MigracaoLegadoModule {}
