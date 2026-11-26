import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AtivoService } from './ativo.service';
import { AtivoDocumentoService } from './ativo-documento.service';
import { criarAtivoSchema, CriarAtivoDto } from './dto/criar-ativo.dto';
import { atualizarAtivoSchema, AtualizarAtivoDto } from './dto/atualizar-ativo.dto';
import { listarAtivosSchema, ListarAtivosDto } from './dto/listar-ativos.dto';
import { Area } from '../../common/decorators/area.decorator';
import { FILTROS_FROTA, FrotaVisaoService } from './frota-visao.service';
import { PreparacaoService } from './preparacao.service';

const listarFrotaSchema = z.object({
  filtro: z.enum(FILTROS_FROTA).optional(),
  busca: z.string().trim().min(1).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
type ListarFrotaDto = z.infer<typeof listarFrotaSchema>;

const anexarDocSchema = z.object({
  tipo: z.enum(['crlv', 'nota_fiscal', 'laudo', 'outro']).default('outro'),
  nome: z.string().trim().min(1),
  conteudo: z.string().min(1), // base64 (data URL ou puro)
});
type AnexarDocBody = z.infer<typeof anexarDocSchema>;

// Preparação do veículo (doc 02 §25.8).
const abrirPreparacaoSchema = z.object({ oQueFalta: z.string().trim().max(500).optional() });
const marcarItemSchema = z.object({ situacao: z.enum(['feito', 'nao_se_aplica']).nullable() });
const novoItemSchema = z.object({ descricao: z.string().trim().min(1).max(120) });
const modeloChecklistSchema = z.object({
  itens: z.array(z.object({ id: z.string().optional(), descricao: z.string().trim().min(1).max(120) })).min(1).max(40),
});

@Area(AreaSistema.ATIVOS_FROTA)
@Controller('ativos')
export class AtivoController {
  constructor(
    private readonly ativoService: AtivoService,
    private readonly documentos: AtivoDocumentoService,
    private readonly frotaVisao: FrotaVisaoService,
    private readonly preparacao: PreparacaoService,
  ) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarAtivoSchema)) dto: CriarAtivoDto, @CurrentUser() user: UsuarioAutenticado) {
    return this.ativoService.criar(dto, user.id);
  }

  // --- Preparação do veículo (doc 02 §25.8) — rotas fixas antes de :id ---
  @Get('preparacao/modelo')
  modeloChecklist() {
    return this.preparacao.modelo();
  }

  @Roles(RoleUsuario.ADMIN)
  @Put('preparacao/modelo')
  salvarModeloChecklist(
    @Body(new ZodValidationPipe(modeloChecklistSchema)) body: z.infer<typeof modeloChecklistSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.preparacao.salvarModelo(body.itens, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch('preparacao/itens/:itemId')
  marcarItemPreparacao(
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(marcarItemSchema)) body: z.infer<typeof marcarItemSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.preparacao.marcarItem(itemId, body.situacao, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete('preparacao/itens/:itemId')
  removerItemPreparacao(@Param('itemId') itemId: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.preparacao.removerItem(itemId, user.id);
  }

  @Get(':id/preparacao')
  preparacaoDoAtivo(@Param('id') id: string) {
    return this.preparacao.doAtivo(id);
  }

  // "Liberar para venda" (Recuperado) — abre a preparação com o checklist.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post(':id/liberar-para-venda')
  @HttpCode(200)
  liberarParaVenda(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(abrirPreparacaoSchema)) body: z.infer<typeof abrirPreparacaoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.preparacao.abrir(id, 'RECUPERACAO', body.oQueFalta, user.id);
  }

  // "Enviar para preparação" (Disponível → oficina, documento, manutenção).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post(':id/preparacao')
  @HttpCode(200)
  enviarParaPreparacao(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(abrirPreparacaoSchema)) body: z.infer<typeof abrirPreparacaoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.preparacao.abrir(id, 'MANUTENCAO', body.oQueFalta, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post(':id/preparacao/itens')
  @HttpCode(201)
  incluirItemPreparacao(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(novoItemSchema)) body: z.infer<typeof novoItemSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.preparacao.adicionarItem(id, body.descricao, user.id);
  }

  // "Marcar como pronto" — checklist completo, o carro vira Disponível.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post(':id/preparacao/concluir')
  @HttpCode(200)
  concluirPreparacao(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.preparacao.concluir(id, user.id);
  }

  @Area(AreaSistema.ATIVOS_FROTA, AreaSistema.COMERCIAL, AreaSistema.CAPITAL_INVESTIMENTO)
  @Get()
  listar(
    @Query(new ZodValidationPipe(listarAtivosSchema)) filtros: ListarAtivosDto,
  ) {
    return this.ativoService.listar(filtros);
  }

  // Busca por chassi ou placa exatos. Declarada antes de :id para não colidir.
  @Area(AreaSistema.ATIVOS_FROTA, AreaSistema.COMERCIAL, AreaSistema.CAPITAL_INVESTIMENTO)
  @Get('buscar')
  buscar(@Query('chassi') chassi?: string, @Query('placa') placa?: string) {
    return this.ativoService.buscarPorIdentificador({ chassi, placa });
  }

  // --- Frota e ficha do veículo (doc 02 §25.7) ---
  @Get('frota')
  frota(@Query(new ZodValidationPipe(listarFrotaSchema)) q: ListarFrotaDto) {
    return this.frotaVisao.lista(q);
  }

  @Get('frota/resumo')
  frotaResumo() {
    return this.frotaVisao.resumo();
  }

  @Get(':id/ficha')
  ficha(@Param('id') id: string) {
    return this.frotaVisao.ficha(id);
  }

  // --- Central de documentos do veículo (Doc 2 §4.4-A) ---
  @Area(AreaSistema.ATIVOS_FROTA, AreaSistema.COMERCIAL, AreaSistema.CAPITAL_INVESTIMENTO)
  @Get(':id/documentos')
  documentosDoAtivo(@Param('id') id: string) {
    return this.documentos.listar(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post(':id/documentos')
  @HttpCode(201)
  anexarDocumento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(anexarDocSchema)) dto: AnexarDocBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.documentos.anexar(id, dto, user.id);
  }

  @Area(AreaSistema.ATIVOS_FROTA, AreaSistema.COMERCIAL, AreaSistema.CAPITAL_INVESTIMENTO)
  @Get('documentos/:docId/download')
  async baixarDocumento(@Param('docId') docId: string): Promise<StreamableFile> {
    const { nome, buffer } = await this.documentos.arquivo(docId);
    return new StreamableFile(buffer, { disposition: `attachment; filename="${encodeURIComponent(nome)}"` });
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete('documentos/:docId')
  removerDocumento(@Param('docId') docId: string) {
    return this.documentos.remover(docId);
  }

  @Area(AreaSistema.ATIVOS_FROTA, AreaSistema.COMERCIAL, AreaSistema.CAPITAL_INVESTIMENTO)
  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.ativoService.buscarPorId(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarAtivoSchema)) dto: AtualizarAtivoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ativoService.atualizar(id, dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id') id: string) {
    await this.ativoService.remover(id);
  }
}
