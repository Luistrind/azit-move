import { Module } from '@nestjs/common';
import { FipeService } from './fipe.service';
import { FipeController } from './fipe.controller';

// Consulta à Tabela FIPE oficial (decisão Luís 01/10 — doc 02 §26.11) e busca em
// tela para o veículo de referência (doc 02 §29.1).
@Module({ controllers: [FipeController], providers: [FipeService], exports: [FipeService] })
export class FipeModule {}
