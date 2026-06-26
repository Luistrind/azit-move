import { Module } from '@nestjs/common';
import { ContaController } from './conta.controller';
import { ContaService } from './conta.service';

// Conta — relacionamento financeiro do titular (Doc 2 §4.3, item 2.2).
@Module({
  controllers: [ContaController],
  providers: [ContaService],
  exports: [ContaService],
})
export class ContaModule {}
