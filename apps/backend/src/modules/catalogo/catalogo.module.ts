import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';
import { CatalogoFonteService } from './catalogo-fonte.service';

// Catálogo de Produtos — F1 (gestão) + F2 (fonte do simulador) — doc 02 §17.
@Module({
  controllers: [CatalogoController],
  providers: [CatalogoFonteService],
  exports: [CatalogoFonteService],
})
export class CatalogoModule {}
