import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { QueuesModule } from './modules/queues/queues.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TitularModule } from './modules/titular/titular.module';
import { ContaModule } from './modules/conta/conta.module';
import { AtivoModule } from './modules/ativo/ativo.module';
import { OrigemCapitalModule } from './modules/origem-capital/origem-capital.module';
import { ContratoModule } from './modules/contrato/contrato.module';
import { AsaasModule } from './modules/asaas/asaas.module';
import { CobrancaModule } from './modules/cobranca/cobranca.module';
import { ReguaModule } from './modules/regua/regua.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

// Módulo raiz. Guards globais: JwtAuthGuard autentica todas as rotas (exceto @Public)
// e RolesGuard autoriza por role quando a rota usa @Roles (Doc 6 §7).
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    QueuesModule,
    HealthModule,
    AuthModule,
    TitularModule,
    ContaModule,
    AtivoModule,
    OrigemCapitalModule,
    ContratoModule,
    AsaasModule,
    CobrancaModule,
    ReguaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
