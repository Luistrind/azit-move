import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

// Limite por IP nas rotas de ENTRADA (doc 06 §2.5, §11.3): 10 tentativas por
// minuto em POST /auth/login e POST /auth/google → 429. Só nessas rotas (o
// guard não é global): o resto da API não é alvo de força bruta de credencial.
// A resposta segue o formato de erro do sistema ({ erro, mensagem }), não o
// padrão da biblioteca. O rastreio é por `req.ip`, que com trustProxy já é o
// IP do cliente atrás do Traefik.
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: { ip?: string; ips?: string[] }): Promise<string> {
    return (req.ips?.length ? req.ips[0] : req.ip) ?? 'desconhecido';
  }

  protected async throwThrottlingException(_context: ExecutionContext, _detail: ThrottlerLimitDetail): Promise<void> {
    throw new HttpException(
      { erro: 'muitas_tentativas', mensagem: 'Muitas tentativas de entrada. Aguarde um minuto e tente de novo.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
