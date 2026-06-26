import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

// Health check — Bloco 0.4. Rota pública usada para confirmar que o app subiu.
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'azit-move-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
