import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';

// Catálogo de Produtos F1 — Produto → Variante → Versão (doc 02 §17).
@Module({
  controllers: [CatalogoController],
})
export class CatalogoModule {}
