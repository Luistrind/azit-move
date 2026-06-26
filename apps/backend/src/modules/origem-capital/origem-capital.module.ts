import { Module } from '@nestjs/common';
import { OrigemCapitalController } from './origem-capital.controller';
import { OrigemCapitalService } from './origem-capital.service';

// OrigemCapital — como o ativo foi financiado (Doc 2 §4.5, item 2.4).
@Module({
  controllers: [OrigemCapitalController],
  providers: [OrigemCapitalService],
  exports: [OrigemCapitalService],
})
export class OrigemCapitalModule {}
