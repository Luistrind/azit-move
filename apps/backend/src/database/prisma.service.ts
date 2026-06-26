import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { softDeleteExtension } from './soft-delete.extension';

// PrismaClient como NestJS service (Doc 4 §7.2) + soft delete global (Doc 5 §1.1, §11.1).
//
// Convenção: use `prisma.db.<modelo>` por padrão — esse cliente estendido filtra
// deletedAt: null nas leituras e converte delete/deleteMany em soft delete.
// O cliente cru (`prisma.<modelo>`) só deve ser usado quando se precisa contornar
// o soft delete deliberadamente (ex: relatórios de auditoria sobre deletados).
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // Cliente estendido com a extensão de soft delete. Compartilha a conexão da base.
  readonly db = this.$extends(softDeleteExtension);

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
