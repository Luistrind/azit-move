import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AlcadaService } from './alcada.service';

const salvarCelulaSchema = z.object({
  papel: z.nativeEnum(RoleUsuario),
  tipoOperacao: z.string().min(1),
  limiteMaximo: z.number().int().min(0).optional(), // centavos
  ilimitado: z.boolean().optional(),
  ativo: z.boolean().optional(),
});
type SalvarCelulaBody = z.infer<typeof salvarCelulaSchema>;

const criarOperacaoSchema = z.object({
  chave: z.string().min(2),
  nome: z.string().min(2),
});
type CriarOperacaoBody = z.infer<typeof criarOperacaoSchema>;

const salvarOperacaoSchema = z.object({
  aprovacoesNecessarias: z.number().int().min(1).max(5).optional(),
  nome: z.string().min(2).optional(),
  ativo: z.boolean().optional(),
});
type SalvarOperacaoBody = z.infer<typeof salvarOperacaoSchema>;

@Controller('alcadas')
export class AlcadaController {
  constructor(private readonly alcada: AlcadaService) {}

  // Matriz configurável (papel × operação → limite). Transparente para leitura.
  @Get()
  matriz() {
    return this.alcada.matriz();
  }

  // Admin edita uma célula da matriz.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Put()
  salvar(
    @Body(new ZodValidationPipe(salvarCelulaSchema)) dto: SalvarCelulaBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.alcada.salvarCelula(dto, user.id);
  }

  // Admin cadastra um novo tipo de operação (ex.: outra modalidade de renegociação).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('operacoes')
  criarOperacao(
    @Body(new ZodValidationPipe(criarOperacaoSchema)) dto: CriarOperacaoBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.alcada.criarOperacao(dto, user.id);
  }

  // Admin ajusta uma operação (nº de aprovações exigidas, nome, ativo).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Put('operacoes/:chave')
  salvarOperacao(
    @Param('chave') chave: string,
    @Body(new ZodValidationPipe(salvarOperacaoSchema)) dto: SalvarOperacaoBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.alcada.salvarOperacao(chave, dto, user.id);
  }
}
