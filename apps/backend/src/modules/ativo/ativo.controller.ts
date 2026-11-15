import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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

const anexarDocSchema = z.object({
  tipo: z.enum(['crlv', 'nota_fiscal', 'laudo', 'outro']).default('outro'),
  nome: z.string().trim().min(1),
  conteudo: z.string().min(1), // base64 (data URL ou puro)
});
type AnexarDocBody = z.infer<typeof anexarDocSchema>;

@Area(AreaSistema.ATIVOS_FROTA)
@Controller('ativos')
export class AtivoController {
  constructor(
    private readonly ativoService: AtivoService,
    private readonly documentos: AtivoDocumentoService,
  ) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarAtivoSchema)) dto: CriarAtivoDto) {
    return this.ativoService.criar(dto);
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
  ) {
    return this.ativoService.atualizar(id, dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id') id: string) {
    await this.ativoService.remover(id);
  }
}
