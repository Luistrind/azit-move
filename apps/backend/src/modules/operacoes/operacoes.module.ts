import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { OperacoesController } from './operacoes.controller';
import { RenegociacaoService } from './renegociacao.service';
import { QuitacaoService } from './quitacao.service';
import { SinistroService } from './sinistro.service';
import { EfetivarAcordoProcessor } from './efetivar-acordo.processor';

// Bloco 6 — operações sobre contratos: renegociação (novação), quitação
// antecipada, sinistro. AsaasService e AlcadaService vêm de módulos globais.
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EFETIVAR_ACORDO })],
  controllers: [OperacoesController],
  providers: [
    RenegociacaoService,
    QuitacaoService,
    SinistroService,
    EfetivarAcordoProcessor,
  ],
  exports: [RenegociacaoService],
})
export class OperacoesModule {}
