import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PermissoesService } from './permissoes.service';
import { AreaBootVerificacao } from './area-boot.verificacao';

// Global: o AreaGuard (APP_GUARD) e qualquer módulo consultam as áreas efetivas
// sem importar nada (doc 06 §5.4 item 4). A verificação de boot percorre os
// controllers registrados e derruba a subida se faltar classificação (§7.5).
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [PermissoesService, AreaBootVerificacao],
  exports: [PermissoesService],
})
export class PermissoesModule {}
