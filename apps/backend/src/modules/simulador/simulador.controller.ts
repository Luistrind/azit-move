import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ParametrosService } from './parametros.service';
import { OfertaFixaService } from './oferta-fixa.service';

const frequenciaSchema = z.enum(['mensal', 'quinzenal', 'semanal']);

const ofertaPadraoSchema = z.object({
  prazoMeses: z.number().int().min(1).max(120),
  frequencia: z.enum(['MENSAL', 'QUINZENAL', 'SEMANAL']),
  valorEntrada: z.number().int().min(0), // centavos
});

const criarVersaoSchema = z.object({
  comissaoInicial: z.number().int().min(0), // centavos
  comissaoRecorrente: z.number().int().min(0),
  taxaMensal: z.number().min(0).max(1), // fração a.m.
  taxaDescontoAntecipacaoCR: z.number().min(0).max(1),
  entradaMinima: z.number().int().min(0),
  prazoMinMeses: z.number().int().min(1),
  prazoMaxMeses: z.number().int().min(1),
  prazosPadronizados: z.array(z.number().int().min(1)).min(1),
  fatorPrecificacaoSemanal: z.number().min(1),
  fatorPrecificacaoQuinzenal: z.number().min(1),
  fatorSemanal: z.number().min(1),
  fatorQuinzenal: z.number().min(1),
  validadeDias: z.number().int().min(1).max(90),
  ofertasPadrao: z.array(ofertaPadraoSchema).max(5),
});
type CriarVersaoBody = z.infer<typeof criarVersaoSchema>;

const ofertaFixaSchema = z.object({
  nome: z.string().trim().min(2),
  valorEntrada: z.number().int().min(0),
  valorParcela: z.number().int().min(1),
  frequencia: frequenciaSchema,
  prazoMeses: z.number().int().min(1).max(120),
  vigenciaInicio: z.coerce.date().optional(),
  vigenciaFim: z.coerce.date().optional(),
});
type OfertaFixaBody = z.infer<typeof ofertaFixaSchema>;

const atualizarOfertaFixaSchema = ofertaFixaSchema.partial().extend({
  ativa: z.boolean().optional(),
});
type AtualizarOfertaFixaBody = z.infer<typeof atualizarOfertaFixaSchema>;

// Configuração do simulador (Doc 2 §4-A.2/4-A.3): parâmetros versionados e
// ofertas fixas. Leitura livre (telas); escrita restrita a ADMIN/DIRETOR.
@Controller('simulador')
export class SimuladorController {
  constructor(
    private readonly parametros: ParametrosService,
    private readonly ofertaFixa: OfertaFixaService,
  ) {}

  @Get('parametros')
  vigente() {
    return this.parametros.vigente();
  }

  @Get('parametros/versoes')
  versoes() {
    return this.parametros.listar();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('parametros')
  criarVersao(
    @Body(new ZodValidationPipe(criarVersaoSchema)) dto: CriarVersaoBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.parametros.criarVersao(dto, user.id);
  }

  @Get('ofertas-fixas')
  ofertasFixas() {
    return this.ofertaFixa.listar();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('ofertas-fixas')
  criarOfertaFixa(@Body(new ZodValidationPipe(ofertaFixaSchema)) dto: OfertaFixaBody) {
    return this.ofertaFixa.criar(dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Patch('ofertas-fixas/:id')
  atualizarOfertaFixa(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarOfertaFixaSchema)) dto: AtualizarOfertaFixaBody,
  ) {
    return this.ofertaFixa.atualizar(id, dto);
  }
}
