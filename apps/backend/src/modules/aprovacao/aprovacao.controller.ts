import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AprovacaoService } from './aprovacao.service';

const decidirSchema = z.object({
  decisao: z.enum(['aprovar', 'recomendar', 'reprovar']),
  parecer: z.string().trim().min(1).optional(),
});
type DecidirBody = z.infer<typeof decidirSchema>;

// Central de aprovações (Doc 2 §7.9-A). Quem pode o quê é decidido pela alçada no
// service (não por @Roles): qualquer usuário vê a fila; aprovar/reprovar exige alçada.
@Controller('aprovacoes')
export class AprovacaoController {
  constructor(private readonly aprovacao: AprovacaoService) {}

  @Get('pendentes')
  pendentes(@CurrentUser() user: UsuarioAutenticado) {
    return this.aprovacao.pendentes(user.id);
  }

  @Get('historico')
  historico(@CurrentUser() user: UsuarioAutenticado) {
    return this.aprovacao.historico(user.id);
  }

  @Get('contagem')
  contagem() {
    return this.aprovacao.contagem();
  }

  @Post(':id/decidir')
  @HttpCode(200)
  decidir(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decidirSchema)) dto: DecidirBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.aprovacao.decidir(id, user.id, dto.decisao, dto.parecer);
  }
}
