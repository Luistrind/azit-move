import { Module } from '@nestjs/common';
import { ContratoModule } from '../contrato/contrato.module';
import { OriginacaoController } from './originacao.controller';
import { OriginacaoService } from './originacao.service';

// Bloco 7 — Originação real (PopHub). Reusa o ContratoService do núcleo.
@Module({
  imports: [ContratoModule],
  controllers: [OriginacaoController],
  providers: [OriginacaoService],
})
export class OriginacaoModule {}
