import { Module } from '@nestjs/common';
import { FipeService } from './fipe.service';

// Consulta à Tabela FIPE oficial (decisão Luís 01/10 — doc 02 §26.11).
@Module({ providers: [FipeService], exports: [FipeService] })
export class FipeModule {}
