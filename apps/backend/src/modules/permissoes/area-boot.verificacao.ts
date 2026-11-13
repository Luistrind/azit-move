import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { ClasseController, ehController, rotasSemClassificacao } from '../../common/guards/area.classificacao';

// Verificação no boot (doc 06 §5.4 item 6, §7.5): percorre os controllers
// registrados e derruba a subida se alguma rota ficou sem @Area / @AreaLivre /
// @Public. Ninguém esquece de classificar — e o teste jest
// (area.classificacao.spec.ts) faz a mesma varredura sem subir a aplicação.
@Injectable()
export class AreaBootVerificacao implements OnApplicationBootstrap {
  private readonly logger = new Logger(AreaBootVerificacao.name);

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap() {
    const controllers: ClasseController[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const classe: unknown = wrapper.metatype;
      if (ehController(classe)) controllers.push(classe);
    }
    const faltantes = rotasSemClassificacao(controllers);
    if (faltantes.length > 0) {
      throw new Error(
        `Rotas sem classificação de área (@Area ou @AreaLivre — doc 06 §7.5): ${faltantes.join(', ')}`,
      );
    }
    this.logger.log(`Áreas de trabalho: ${controllers.length} controllers classificados`);
  }
}
