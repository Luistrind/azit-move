import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { Area } from '../../common/decorators/area.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { SalvarParametrosWhatsapp, WhatsappParametrosService } from './whatsapp-parametros.service';

// Configuração › WhatsApp (doc 02 §23): chave geral dos envios automáticos,
// números autorizados fora de produção e o modelo de cada momento. Mesmo
// recorte da central de integrações: área Configurações, ADMIN/DIRETOR.
@Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
@Area(AreaSistema.CONFIGURACOES)
@Controller('whatsapp/parametros')
export class WhatsappConfigController {
  constructor(private readonly parametros: WhatsappParametrosService) {}

  @Get()
  ver() {
    return this.parametros.tela();
  }

  @Put()
  @HttpCode(200)
  salvar(@Body() body: SalvarParametrosWhatsapp, @CurrentUser() user: UsuarioAutenticado) {
    return this.parametros.salvar(body ?? {}, user.id);
  }
}
