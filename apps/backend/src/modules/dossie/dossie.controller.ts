import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DossieService } from './dossie.service';

type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer) => void };

const arquivoSchema = z.object({
  tipo: z.enum(['captura', 'notificacao', 'infleet']),
  nome: z.string().trim().min(1).max(200),
  conteudo: z.string().min(1), // base64 (data URL ou puro)
});
const gerarSchema = z.object({
  capturas: z.array(z.string().min(1)).min(1).max(200),
  notificacaoId: z.string().optional(),
  infleetId: z.string().optional(),
  infleetDescricao: z.string().trim().max(500).optional(),
  observacao: z.string().trim().max(1000).optional(),
});
const contratoSocialSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  conteudo: z.string().min(1),
  descricao: z.string().trim().max(200).optional(),
});

// Dossiê para cobrança judicial (doc 02 §30) + documentos da empresa.
@Controller()
export class DossieController {
  constructor(private readonly dossie: DossieService) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Post('contratos/:id/dossie/arquivos')
  @HttpCode(201)
  receberArquivo(@Param('id') id: string, @Body(new ZodValidationPipe(arquivoSchema)) dto: z.infer<typeof arquivoSchema>) {
    return this.dossie.receberArquivo(id, dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Post('contratos/:id/dossie')
  @HttpCode(201)
  gerar(@Param('id') id: string, @Body(new ZodValidationPipe(gerarSchema)) dto: z.infer<typeof gerarSchema>, @CurrentUser() user: UsuarioAutenticado) {
    return this.dossie.gerar(id, dto, user.id);
  }

  @Get('contratos/:id/dossies')
  listar(@Param('id') id: string) {
    return this.dossie.listar(id);
  }

  @Get('dossies/:id/pdf')
  async baixar(@Param('id') id: string, @Res() res: Resposta) {
    const { nome, buffer } = await this.dossie.baixar(id);
    res.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${nome}"`).send(buffer);
  }

  // Configuração › Documentos da empresa
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO)
  @Get('empresa/parametros')
  parametrosEmpresa() {
    return this.dossie.parametrosEmpresa();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('empresa/contrato-social')
  @HttpCode(200)
  salvarContratoSocial(@Body(new ZodValidationPipe(contratoSocialSchema)) dto: z.infer<typeof contratoSocialSchema>, @CurrentUser() user: UsuarioAutenticado) {
    return this.dossie.salvarContratoSocial(dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO)
  @Get('empresa/contrato-social/pdf')
  async baixarContratoSocial(@Res() res: Resposta) {
    const { nome, buffer } = await this.dossie.baixarContratoSocial();
    res.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${nome}"`).send(buffer);
  }
}
