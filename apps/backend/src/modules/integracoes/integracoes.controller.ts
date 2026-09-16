import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { IntegracoesService } from './integracoes.service';

// Central de integrações (decisão Luís 15/09) — tela Configurações >
// Integrações. Segredos são WRITE-ONLY: o GET devolve só status mascarado.
@Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
@Controller('integracoes')
export class IntegracoesController {
  constructor(private readonly service: IntegracoesService) {}

  @Get()
  status() {
    return this.service.status();
  }

  @Put()
  @HttpCode(200)
  atualizar(
    @Body()
    body: {
      asaasAmbiente?: string;
      asaasApiKey?: string;
      asaasWebhookSecret?: string;
      zapsignAmbiente?: string;
      zapsignApiToken?: string;
      zapsignWebhookSecret?: string;
    },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.service.atualizar(body ?? {}, user.id);
  }

  @Post('asaas/testar')
  @HttpCode(200)
  testarAsaas() {
    return this.service.testarAsaas();
  }
}
