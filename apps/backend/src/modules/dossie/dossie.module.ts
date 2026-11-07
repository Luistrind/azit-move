import { Module } from '@nestjs/common';
import { DossieController } from './dossie.controller';
import { DossieService } from './dossie.service';

// Dossiê para cobrança judicial (doc 02 §30). Só Prisma (global) + sistema de
// arquivos: lê os PDFs assinados/legado direto do storage para não depender dos
// módulos de assinatura e migração.
@Module({
  controllers: [DossieController],
  providers: [DossieService],
  exports: [DossieService],
})
export class DossieModule {}
