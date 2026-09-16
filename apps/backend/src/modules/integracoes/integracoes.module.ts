import { Global, Module } from '@nestjs/common';
import { IntegracoesController } from './integracoes.controller';
import { IntegracoesService } from './integracoes.service';

// Global: as credenciais efetivas são consumidas por Asaas, ZapSign e pelos
// webhooks sem cada módulo precisar importar este explicitamente.
@Global()
@Module({
  controllers: [IntegracoesController],
  providers: [IntegracoesService],
  exports: [IntegracoesService],
})
export class IntegracoesModule {}
