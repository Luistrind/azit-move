import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Protege endpoints de simulação (/dev/*): só existem fora de produção. Em produção
// respondemos 404 (esconde a existência da rota). Os simuladores fazem o papel de
// eventos do Asaas que, em prod, chegam pelo webhook real. Na HOMOLOGAÇÃO
// (AMBIENTE=homologacao, 17/09) ficam liberados — é ali que se testa.
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('ambiente') === 'producao') {
      throw new NotFoundException();
    }
    return true;
  }
}
