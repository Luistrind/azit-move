import { Module } from '@nestjs/common';
import { AtivoController } from './ativo.controller';
import { AtivoService } from './ativo.service';

// Ativo — o bem objeto do contrato (Doc 2 §4.4, item 2.3).
@Module({
  controllers: [AtivoController],
  providers: [AtivoService],
  exports: [AtivoService],
})
export class AtivoModule {}
