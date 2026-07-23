import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { RoleUsuario, StatusAnalise } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnaliseService } from './analise.service';

// Papéis (RACI do Processo §4, provisório do permissionamento):
// atendente/analista = ADMIN/OPERADOR; COCAD (decisões superiores) = ADMIN/APROVADOR/DIRETOR.

const participanteSchema = z.object({
  rendaDeclarada: z.number().int().min(0).nullable().optional(),
  rendaPresumida: z.number().int().min(0).nullable().optional(),
  rendaApurada: z.number().int().min(0).nullable().optional(),
  justificativaRendaApurada: z.string().min(3).optional(),
  rendaParcialmenteComprovada: z.boolean().optional(),
  identidadeValidada: z.boolean().optional(),
  cnhValida: z.boolean().optional(),
  documentoAlternativo: z.boolean().optional(),
  atividadeComprovada: z.boolean().optional(),
  evidenciaAtividade: z.string().optional(),
  processosRelevantes: z.boolean().optional(),
  observacoes: z.string().optional(),
});

const consultaSchema = z.object({
  titularId: z.string().min(1),
  tipo: z.enum(['camada1', 'score_quod', 'restritivos']),
  fornecedor: z.string().min(2),
  protocolo: z.string().optional(),
  situacao: z.enum(['concluida', 'falha']),
  motivoFalha: z.string().optional(),
  custo: z.number().int().min(0).optional(),
  resultado: z
    .object({
      score: z.number().int().min(0).max(1000).optional(),
      restritivosFinanceiros: z.number().int().min(0).optional(),
      restritivosNaoFinanceiros: z.number().int().min(0).optional(),
      protestoChequeExecucao: z.boolean().optional(),
      resumo: z.string().optional(),
    })
    .optional(),
});

const parecerSchema = z.object({
  tipo: z.enum(['aprovacao', 'cocad', 'complemento', 'nao_aprovacao']),
  texto: z.string().min(10),
  codigos: z.array(z.string()).min(1),
});

const pendenciaSchema = z.object({
  titularId: z.string().optional(),
  codigo: z.string().regex(/^COM-\d{2}$/),
  descricao: z.string().min(5),
});

const ressalvasSchema = z.object({
  ressalvas: z
    .array(
      z.object({
        tipo: z.enum(['AUMENTO_ENTRADA', 'REDUCAO_PROPOSTA', 'GARANTIDOR', 'DOCUMENTO_ADICIONAL', 'AJUSTE_CONDICAO']),
        condicao: z.string().min(5),
      }),
    )
    .min(1),
});

const naoAprovarSchema = z.object({
  codigo: z.string().regex(/^NAP-\d{2}$/),
  justificativa: z.string().min(10),
});

@Controller()
export class AnaliseController {
  constructor(private readonly analise: AnaliseService) {}

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('propostas/:propostaId/analise')
  @HttpCode(201)
  iniciar(@Param('propostaId') propostaId: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.analise.iniciar(propostaId, user.id);
  }

  @Get('analises/:id')
  dossie(@Param('id') id: string) {
    return this.analise.dossie(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch('analises/:id/participantes/:titularId')
  atualizarParticipante(
    @Param('id') id: string,
    @Param('titularId') titularId: string,
    @Body(new ZodValidationPipe(participanteSchema)) dto: z.infer<typeof participanteSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.atualizarParticipante(id, titularId, dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/condutor/:titularId')
  @HttpCode(200)
  definirCondutor(@Param('id') id: string, @Param('titularId') titularId: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.analise.definirCondutor(id, titularId, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/autorizacoes/:titularId')
  @HttpCode(201)
  registrarAutorizacao(
    @Param('id') id: string,
    @Param('titularId') titularId: string,
    @Body() body: { evidenciaRef?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.registrarAutorizacao(id, titularId, user.id, body?.evidenciaRef);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/consultas')
  @HttpCode(201)
  registrarConsulta(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(consultaSchema)) dto: z.infer<typeof consultaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.registrarConsulta(id, dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/transicao')
  @HttpCode(200)
  transicionar(
    @Param('id') id: string,
    @Body() body: { para: StatusAnalise; motivo?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.transicionar(id, body.para, user.id, body.motivo);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/pendencias')
  @HttpCode(201)
  criarPendencia(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(pendenciaSchema)) dto: z.infer<typeof pendenciaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.criarPendencia(id, dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/pendencias/:pendenciaId/cumprir')
  @HttpCode(200)
  cumprirPendencia(@Param('id') id: string, @Param('pendenciaId') pendenciaId: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.analise.cumprirPendencia(id, pendenciaId, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/parecer')
  @HttpCode(201)
  emitirParecer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(parecerSchema)) dto: z.infer<typeof parecerSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.emitirParecer(id, dto, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/aprovar')
  @HttpCode(200)
  aprovarAlcada(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.analise.aprovarAlcadaAnalista(id, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/cocad')
  @HttpCode(200)
  submeterCocad(@Param('id') id: string, @Body() body: { recomendacao?: string }, @CurrentUser() user: UsuarioAutenticado) {
    return this.analise.submeterCocad(id, user.id, body?.recomendacao ?? '');
  }

  // Decisões do COCAD (2ª instância) — papéis decisores.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.APROVADOR, RoleUsuario.DIRETOR)
  @Post('analises/:id/cocad/ressalvas')
  @HttpCode(200)
  aprovarComRessalvas(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ressalvasSchema)) dto: z.infer<typeof ressalvasSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.aprovarComRessalvas(id, dto.ressalvas, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.APROVADOR, RoleUsuario.DIRETOR)
  @Post('analises/:id/ressalvas/:ressalvaId/validar')
  @HttpCode(200)
  validarRessalva(
    @Param('id') id: string,
    @Param('ressalvaId') ressalvaId: string,
    @Body() body: { evidenciaRef?: string },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.validarRessalva(id, ressalvaId, user.id, body?.evidenciaRef);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.APROVADOR, RoleUsuario.DIRETOR)
  @Post('analises/:id/nao-aprovar')
  @HttpCode(200)
  naoAprovar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(naoAprovarSchema)) dto: z.infer<typeof naoAprovarSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.naoAprovar(id, dto.codigo, dto.justificativa, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/encerrar')
  @HttpCode(200)
  encerrar(
    @Param('id') id: string,
    @Body() body: { motivo: 'desistencia' | 'ausencia_retorno' | 'expiracao' },
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.analise.encerrar(id, body.motivo, user.id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('analises/:id/liberar')
  @HttpCode(200)
  liberar(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.analise.liberar(id, user.id);
  }
}
