import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { QueuesModule } from './modules/queues/queues.module';
import { HealthModule } from './modules/health/health.module';

// Módulo raiz. Os módulos de domínio (titulares, contratos, etc.) entram nos blocos seguintes.
@Module({
  imports: [ConfigModule, DatabaseModule, QueuesModule, HealthModule],
})
export class AppModule {}
