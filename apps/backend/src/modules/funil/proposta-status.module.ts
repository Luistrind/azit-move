import { Module } from '@nestjs/common';
import { PropostaStatusService } from './proposta-status.service';

// Módulo mínimo (só Prisma, que é global) para que funil E análise usem o mesmo
// gravador de status sem importação circular entre os dois.
@Module({
  providers: [PropostaStatusService],
  exports: [PropostaStatusService],
})
export class PropostaStatusModule {}
