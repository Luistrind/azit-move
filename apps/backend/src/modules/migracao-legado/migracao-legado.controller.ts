import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { MigracaoLegadoService } from './migracao-legado.service';

// Bancada de migração do legado (doc 02 §26). Quem opera: quem vai ao PopHub
// buscar o contrato e conciliar — operação, diretoria e financeiro.
@Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO)
@Controller('migracao-legado')
export class MigracaoLegadoController {
  constructor(private readonly migracao: MigracaoLegadoService) {}

  // Última coleta, contagens por status/situação e as opções dos filtros.
  @Get('resumo')
  resumo() {
    return this.migracao.resumo();
  }

  // Dispara a leitura do Asaas (segundo plano). 202: a tela acompanha pelo resumo.
  @Post('coletar')
  @HttpCode(202)
  coletar(@CurrentUser() user: UsuarioAutenticado) {
    return this.migracao.iniciarColeta(user.id);
  }

  @Get('casos')
  listar(@Query() q: { status?: string; situacao?: string; busca?: string }) {
    return this.migracao.listar(q);
  }

  @Get('casos/:id')
  caso(@Param('id') id: string) {
    return this.migracao.caso(id);
  }

  @Patch('casos/:id/status')
  mudarStatus(
    @Param('id') id: string,
    @Body() body: { status: string; observacao?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.migracao.mudarStatus(id, body.status, user.id, body.observacao);
  }

  @Patch('casos/:id/observacao')
  anotar(@Param('id') id: string, @Body() body: { observacao: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.migracao.anotar(id, body.observacao ?? '', user.id);
  }
}
