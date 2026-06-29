import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queues.module';
import { ContratoModule } from '../contrato/contrato.module';
import { OperacoesController } from './operacoes.controller';
import { RenegociacaoService } from './renegociacao.service';
import { NovacaoService } from './novacao.service';
import { QuitacaoService } from './quitacao.service';
import { SinistroService } from './sinistro.service';
import { ReajusteService } from './reajuste.service';
import { EfetivarAcordoProcessor } from './efetivar-acordo.processor';

// Bloco 6 — operações sobre contratos: renegociação (novação), quitação
// antecipada, sinistro. AsaasService e AlcadaService vêm de módulos globais.
@Module({
  imports: [
    ContratoModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EFETIVAR_ACORDO },
      { name: QUEUE_NAMES.NOTIFICAR_CLIENTE },
    ),
  ],
  controllers: [OperacoesController],
  providers: [
    RenegociacaoService,
    NovacaoService,
    QuitacaoService,
    SinistroService,
    ReajusteService,
    EfetivarAcordoProcessor,
  ],
  exports: [RenegociacaoService],
})
export class OperacoesModule {}
