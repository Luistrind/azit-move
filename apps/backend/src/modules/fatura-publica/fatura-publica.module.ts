import { Module } from '@nestjs/common';
import { FaturaPublicaController } from './fatura-publica.controller';
import { FaturaPublicaService } from './fatura-publica.service';
import { LimitePublicoGuard } from './limite-publico.guard';

// Fatura Azit — página pública da fatura (doc 02 §32). AsaasModule é global
// (leitura do PIX); Prisma vem do DatabaseModule global.
@Module({
  controllers: [FaturaPublicaController],
  providers: [FaturaPublicaService, LimitePublicoGuard],
})
export class FaturaPublicaModule {}
