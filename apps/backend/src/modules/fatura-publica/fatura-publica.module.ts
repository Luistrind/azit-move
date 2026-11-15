import { Module } from '@nestjs/common';
import { FaturamentoModule } from '../faturamento/faturamento.module';
import { FaturaPublicaController } from './fatura-publica.controller';
import { FaturaPublicaService } from './fatura-publica.service';
import { LimitePublicoGuard } from './limite-publico.guard';

// Fatura Azit — página pública da fatura (doc 02 §32). AsaasModule é global
// (leitura do PIX); Prisma vem do DatabaseModule global. FaturamentoModule traz
// a conta do modelo AZIT e a intenção de pagamento (F2).
@Module({
  imports: [FaturamentoModule],
  controllers: [FaturaPublicaController],
  providers: [FaturaPublicaService, LimitePublicoGuard],
})
export class FaturaPublicaModule {}
