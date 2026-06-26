import { Module } from '@nestjs/common';
import { TitularController } from './titular.controller';
import { TitularService } from './titular.service';

// Titular — cadastro único (Doc 2 §4.1, Doc 7 item 2.1). PrismaService vem do
// DatabaseModule global. Exporta o service para os módulos de Conta/Contrato.
@Module({
  controllers: [TitularController],
  providers: [TitularService],
  exports: [TitularService],
})
export class TitularModule {}
