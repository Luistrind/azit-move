import { Module } from '@nestjs/common';
import { AtivoController } from './ativo.controller';
import { AtivoService } from './ativo.service';
import { AtivoDocumentoService } from './ativo-documento.service';

// Ativo — o bem objeto do contrato (Doc 2 §4.4, item 2.3) + central de documentos.
@Module({
  controllers: [AtivoController],
  providers: [AtivoService, AtivoDocumentoService],
  exports: [AtivoService],
})
export class AtivoModule {}
