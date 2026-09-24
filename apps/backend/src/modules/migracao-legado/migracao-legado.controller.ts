import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { MigracaoLegadoService } from './migracao-legado.service';
import { LegadoConciliacaoService } from './legado-conciliacao.service';

type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer) => void };

// Bancada de migração do legado (doc 02 §26). Quem opera: quem vai ao PopHub
// buscar o contrato e conciliar — operação, diretoria e financeiro.
@Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO)
@Controller('migracao-legado')
export class MigracaoLegadoController {
  constructor(
    private readonly migracao: MigracaoLegadoService,
    private readonly conciliacao: LegadoConciliacaoService,
  ) {}

  // ---- F1: leitura, fila e caso ----

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
  mudarStatus(@Param('id') id: string, @Body() body: { status: string; observacao?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.migracao.mudarStatus(id, body.status, user.id, body.observacao);
  }

  @Patch('casos/:id/observacao')
  anotar(@Param('id') id: string, @Body() body: { observacao: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.migracao.anotar(id, body.observacao ?? '', user.id);
  }

  // ---- F2 (doc 02 §26.7): termos, PDF, leitura das cobranças, conciliação, validação ----

  @Put('casos/:id/termos')
  salvarTermos(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.salvarTermos(id, body, user.id);
  }

  // PDF do contrato (base64, mesmo padrão dos documentos do ativo). Lê o texto e
  // pré-preenche os termos que ainda estiverem vazios.
  @Post('casos/:id/pdf')
  @HttpCode(200)
  anexarPdf(@Param('id') id: string, @Body() body: { nome: string; conteudo: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.anexarPdf(id, body, user.id);
  }

  @Get('casos/:id/pdf')
  async baixarPdf(@Param('id') id: string, @Res() res: Resposta) {
    const { nome, buffer } = await this.conciliacao.baixarPdf(id);
    res.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${nome}"`).send(buffer);
  }

  // Reaplica as regras de leitura nas cobranças que o operador não decidiu.
  @Post('casos/:id/interpretar')
  @HttpCode(200)
  interpretar(@Param('id') id: string) {
    return this.conciliacao.interpretarCobrancasDoCaso(id, 'regra');
  }

  @Put('casos/:id/cobrancas/:cobrancaId/interpretacao')
  definirInterpretacao(
    @Param('id') id: string,
    @Param('cobrancaId') cobrancaId: string,
    @Body() body: { tipo: string; parcelamento?: number; seguro?: number; taxa?: number; intermediaria?: number; observacao?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.conciliacao.definirInterpretacao(id, cobrancaId, body, user.id);
  }

  @Delete('casos/:id/cobrancas/:cobrancaId/interpretacao')
  desfazerInterpretacao(@Param('id') id: string, @Param('cobrancaId') cobrancaId: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.desfazerInterpretacao(id, cobrancaId, user.id);
  }

  @Put('casos/:id/divergencias/:chave')
  reconhecer(@Param('id') id: string, @Param('chave') chave: string, @Body() body: { nota: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.reconhecerDivergencia(id, decodeURIComponent(chave), body?.nota ?? '', user.id);
  }

  @Delete('casos/:id/divergencias/:chave')
  desfazerReconhecimento(@Param('id') id: string, @Param('chave') chave: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.desfazerReconhecimento(id, decodeURIComponent(chave), user.id);
  }

  @Put('casos/:id/vinculos/:cobrancaId')
  vincular(@Param('id') id: string, @Param('cobrancaId') cobrancaId: string, @Body() body: { chave: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.vincular(id, cobrancaId, body?.chave ?? '', user.id);
  }

  @Delete('casos/:id/vinculos/:cobrancaId')
  desvincular(@Param('id') id: string, @Param('cobrancaId') cobrancaId: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.desvincular(id, cobrancaId, user.id);
  }

  @Post('casos/:id/validar')
  @HttpCode(200)
  validar(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.conciliacao.validar(id, user.id);
  }
}
