import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { z } from 'zod';
import { GRUPOS_CASCATA } from '@azit/utils';
import { Area } from '../../common/decorators/area.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ParametrosFaturamentoService, type SalvarParametrosFaturamentoDto } from './parametros-faturamento.service';

const SALVAR = z.object({
  pixSobDemanda: z.boolean().optional(),
  multaPadraoPct: z.number().optional(),
  atualizacaoMesPadraoPct: z.number().optional(),
  cascata: z.array(z.enum(GRUPOS_CASCATA)).optional(),
  minimoParcialPct: z.number().optional(),
  minimoParcialPiso: z.number().int().optional(), // centavos
  tetoIntencoesDia: z.number().int().optional(),
  motivo: z.string().max(500).nullish(),
});

// Configurações › Faturamento (doc 02 §32.8): parâmetros FAT001–FAT004, o teto
// de intenções por dia e a chave do Pix sob demanda (§32.4-A), com histórico
// de versões. Leitura para quem tem a área; escrita restrita a ADMIN/DIRETOR
// e auditada.
@Area(AreaSistema.CONFIGURACOES)
@Controller('faturamento')
export class FaturamentoController {
  constructor(private readonly parametros: ParametrosFaturamentoService) {}

  @Get('parametros')
  obter() {
    return this.parametros.tela();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post('parametros')
  @HttpCode(200)
  salvar(@Body(new ZodValidationPipe(SALVAR)) dto: SalvarParametrosFaturamentoDto, @CurrentUser() user: UsuarioAutenticado) {
    return this.parametros.salvar(dto, user.id);
  }
}
