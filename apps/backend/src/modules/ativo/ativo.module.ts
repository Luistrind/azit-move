import { Module } from '@nestjs/common';
import { AtivoController } from './ativo.controller';
import { AtivoService } from './ativo.service';
import { AtivoDocumentoService } from './ativo-documento.service';
import { FrotaVisaoService } from './frota-visao.service';
import { PreparacaoService } from './preparacao.service';
import { CentroCustoModule } from '../centro-custo/centro-custo.module';

// Ativo — o bem objeto do contrato (Doc 2 §4.4, item 2.3) + central de documentos.
@Module({
  imports: [CentroCustoModule],
  controllers: [AtivoController],
  providers: [AtivoService, AtivoDocumentoService, FrotaVisaoService, PreparacaoService],
  exports: [AtivoService, PreparacaoService],
})
export class AtivoModule {}
