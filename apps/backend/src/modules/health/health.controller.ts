import { Controller, Get } from '@nestjs/common';

// Health check — Bloco 0.4. Rota pública usada para confirmar que o app subiu.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'azit-move-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
