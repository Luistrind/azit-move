import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// DatabaseModule global — exporta o PrismaService para todos os módulos de domínio (Doc 4 §7.2).
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
