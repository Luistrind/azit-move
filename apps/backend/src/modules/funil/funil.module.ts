import { Module } from '@nestjs/common';
import { ContratoModule } from '../contrato/contrato.module';
import { TitularModule } from '../titular/titular.module';
import { ContaModule } from '../conta/conta.module';
import { FunilController } from './funil.controller';
import { LeadService } from './lead.service';
import { SimulacaoService } from './simulacao.service';
import { PropostaService } from './proposta.service';
import { FormalizacaoService } from './formalizacao.service';

// Bloco 7 — Originação nativa em tela (funil que antecede e gera o ContratoCredito).
// Reusa o ContratoService do núcleo na formalização e Titular/Conta na promoção.
@Module({
  imports: [ContratoModule, TitularModule, ContaModule],
  controllers: [FunilController],
  providers: [LeadService, SimulacaoService, PropostaService, FormalizacaoService],
})
export class FunilModule {}
