import { Controller, Get } from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { Area } from '../../common/decorators/area.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailService } from './email.service';

// Card "E-mail (Gmail do Workspace)" da Central de integrações (doc 06 §12.4):
// estado, remetente e os últimos envios/falhas da fila. Nunca a credencial.
@Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
@Area(AreaSistema.CONFIGURACOES)
@Controller('integracoes/email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get()
  async status() {
    const [config, ultimos] = await Promise.all([this.email.configuracao(), this.email.ultimosEnvios(5)]);
    return {
      ...config,
      fonte: 'servidor' as const,
      variaveis: ['EMAIL_TRANSPORTE', 'EMAIL_REMETENTE', 'SMTP_HOST', 'SMTP_PORT', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'APP_URL'],
      // Relay SMTP: Admin do Workspace (Apps › Google Workspace › Gmail › Roteamento › Relay SMTP).
      console: 'https://admin.google.com/ac/apps/gmail/routing',
      ultimos,
    };
  }
}
