import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ResponsavelOcorrencia, RoleUsuario, SituacaoOperacionalAtivo, TipoOcorrenciaVeiculo } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { FrotaService, ROTULO_SITUACAO, SITUACOES } from './frota.service';
import { OcorrenciaService, ROTULO_STATUS_OCORRENCIA, ROTULO_TIPO } from './ocorrencia.service';
import { InfleetService } from './infleet.service';

type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer) => void };
const OPERACAO_FROTA = [RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR];

// Controle de frota — doc 02 §25. Situação do veículo, ocorrências (multas,
// IPVA, licenciamento) e o desfecho de cada uma.
@Roles(...OPERACAO_FROTA)
@Controller('frota')
export class FrotaController {
  constructor(
    private readonly frota: FrotaService,
    private readonly ocorrencias: OcorrenciaService,
    private readonly infleet: InfleetService,
  ) {}

  // ---- Situação operacional ----
  @Get('quadro')
  quadro() {
    return this.frota.quadro();
  }

  @Get('opcoes')
  opcoes() {
    return {
      situacoes: SITUACOES.map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO[s] })),
      tipos: Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => ({ valor, rotulo })),
      status: Object.entries(ROTULO_STATUS_OCORRENCIA).map(([valor, rotulo]) => ({ valor, rotulo })),
    };
  }

  @Post('ativos/:id/situacao')
  @HttpCode(200)
  mover(
    @Param('id') id: string,
    @Body() body: { situacao: SituacaoOperacionalAtivo; motivo?: string; previsaoRetorno?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.frota.mover(id, body, user.id);
  }

  @Get('ativos/:id/historico')
  historico(@Param('id') id: string) {
    return this.frota.historico(id);
  }

  // ---- Ocorrências ----
  @Get('ocorrencias')
  listar(@Query() q: { status?: string; tipo?: string; responsavel?: string; ativoId?: string; busca?: string }) {
    return this.ocorrencias.listar(q);
  }

  @Post('ocorrencias')
  @HttpCode(201)
  registrar(
    @Body() body: { ativoId?: string; placa?: string; tipo: TipoOcorrenciaVeiculo; orgao?: string; numeroAuto?: string; descricao?: string; dataFato: string; dataVencimento?: string; prazoIndicacao?: string; valor?: number; valorComDesconto?: number },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ocorrencias.registrar({ ...body, origem: 'manual' }, user.id);
  }

  @Post('ocorrencias/:id/responsavel')
  @HttpCode(200)
  responsavel(@Param('id') id: string, @Body() body: { responsavel: ResponsavelOcorrencia; justificativa: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.definirResponsavel(id, body?.responsavel, body?.justificativa, user.id);
  }

  // Desfechos (doc 02 §25.3)
  @Post('ocorrencias/:id/cliente-paga')
  @HttpCode(200)
  clientePaga(@Param('id') id: string, @Body() body: { prazoComprovante?: string; observacao?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.clientePagaDireto(id, body?.prazoComprovante, body?.observacao, user.id);
  }

  @Post('ocorrencias/:id/comprovante')
  @HttpCode(200)
  comprovante(@Param('id') id: string, @Body() body: { arquivo?: { nome: string; conteudo: string }; observacao?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.registrarComprovante(id, body?.arquivo, body?.observacao, user.id);
  }

  @Get('ocorrencias/:id/comprovante')
  async baixarComprovante(@Param('id') id: string, @Res() res: Resposta) {
    const { nome, buffer } = await this.ocorrencias.comprovante(id);
    res.header('Content-Disposition', `inline; filename="${nome}"`).send(buffer);
  }

  @Post('ocorrencias/:id/repassar')
  @HttpCode(200)
  repassar(@Param('id') id: string, @Body() body: { valor?: number }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.repassarNaFatura(id, body?.valor, user.id);
  }

  @Post('ocorrencias/:id/assumir')
  @HttpCode(200)
  assumir(@Param('id') id: string, @Body() body: { observacao?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.assumirAzit(id, body?.observacao, user.id);
  }

  @Post('ocorrencias/:id/recurso')
  @HttpCode(200)
  recurso(@Param('id') id: string, @Body() body: { prazo?: string; observacao?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.emRecurso(id, body?.prazo, body?.observacao, user.id);
  }

  @Post('ocorrencias/:id/cancelar')
  @HttpCode(200)
  cancelar(@Param('id') id: string, @Body() body: { motivo: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.cancelar(id, body?.motivo, user.id);
  }

  @Post('ocorrencias/:id/reabrir')
  @HttpCode(200)
  reabrir(@Param('id') id: string, @Body() body: { motivo?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.ocorrencias.reabrir(id, body?.motivo ?? '', user.id);
  }

  // ---- Robô do Infleet (doc 02 §25.4) ----
  // A credencial NÃO é gravada e NÃO passa por fila: roda aqui, em memória.
  @Post('ocorrencias/importar-infleet')
  @HttpCode(200)
  async importarInfleet(@Body() body: { usuario: string; senha: string }, @CurrentUser() user: UsuarioAutenticado) {
    const { infracoes, naoMapeadas, amostraBruta } = await this.infleet.buscarInfracoes(body?.usuario, body?.senha);
    const resumo = await this.ocorrencias.importarLote(infracoes, user.id);
    return { lidas: infracoes.length + naoMapeadas, ...resumo, naoMapeadas, amostraBruta };
  }
}
