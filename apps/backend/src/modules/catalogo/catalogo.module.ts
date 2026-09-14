import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';
import { CatalogoFonteService } from './catalogo-fonte.service';
import { CatalogoBootstrapService } from './catalogo-bootstrap.service';

// Catálogo de Produtos — F1 (gestão) + F2 (fonte do simulador) — doc 02 §17.
// Bootstrap (14/09): produtos estruturais nascem com o sistema (novacao).
@Module({
  controllers: [CatalogoController],
  providers: [CatalogoFonteService, CatalogoBootstrapService],
  exports: [CatalogoFonteService],
})
export class CatalogoModule {}
