import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Protege endpoints de simulação (/dev/*): só existem fora de produção. Em produção
// respondemos 404 (esconde a existência da rota). Os simuladores fazem o papel de
// eventos do Asaas que, em prod, chegam pelo webhook real.
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('nodeEnv') === 'production') {
      throw new NotFoundException();
    }
    return true;
  }
}
