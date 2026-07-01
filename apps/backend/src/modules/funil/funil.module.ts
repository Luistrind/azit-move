import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ContratoModule } from '../contrato/contrato.module';
import { TitularModule } from '../titular/titular.module';
import { ContaModule } from '../conta/conta.module';
import { QUEUE_NAMES } from '../queues/queues.module';
import { FunilController } from './funil.controller';
import { LeadService } from './lead.service';
import { SimulacaoService } from './simulacao.service';
import { PropostaService } from './proposta.service';
import { FormalizacaoService } from './formalizacao.service';
import { AtivacaoProcessor } from './ativacao.processor';

// Bloco 7 — Originação nativa em tela (funil que antecede e gera o ContratoCredito).
// Reusa o ContratoService do núcleo na formalização e Titular/Conta na promoção.
@Module({
  imports: [
    ContratoModule,
    TitularModule,
    ContaModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.ATIVAR_CONTRATO }),
  ],
  controllers: [FunilController],
  providers: [LeadService, SimulacaoService, PropostaService, FormalizacaoService, AtivacaoProcessor],
})
export class FunilModule {}
