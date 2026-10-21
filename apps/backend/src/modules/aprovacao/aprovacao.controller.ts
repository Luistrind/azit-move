import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AprovacaoService } from './aprovacao.service';
import { AprovacaoDossieService } from './aprovacao-dossie.service';

const decidirSchema = z.object({
  decisao: z.enum(['aprovar', 'recomendar', 'reprovar']),
  parecer: z.string().trim().min(1).optional(),
});
type DecidirBody = z.infer<typeof decidirSchema>;

// Pedir complemento (doc 02 §7.9-A, 21/10): pergunta e resposta em texto.
const perguntaSchema = z.object({ pergunta: z.string().trim().min(5, 'Escreva a pergunta para quem solicitou') });
const respostaSchema = z.object({ resposta: z.string().trim().min(2, 'Escreva a resposta') });

// Central de aprovações (Doc 2 §7.9-A). Quem pode o quê é decidido pela alçada no
// service (não por @Roles): qualquer usuário vê a fila; aprovar/reprovar exige alçada.
@Controller('aprovacoes')
export class AprovacaoController {
  constructor(
    private readonly aprovacao: AprovacaoService,
    private readonly dossie: AprovacaoDossieService,
  ) {}

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

  // Dossiê da solicitação (21/10): o mesmo item da lista + o detalhe por tipo.
  @Get(':id')
  obter(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.dossie.dossie(id, user.id);
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

  @Post(':id/complemento')
  @HttpCode(200)
  pedirComplemento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(perguntaSchema)) dto: z.infer<typeof perguntaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.aprovacao.pedirComplemento(id, user.id, dto.pergunta);
  }

  @Post(':id/complemento/responder')
  @HttpCode(200)
  responderComplemento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(respostaSchema)) dto: z.infer<typeof respostaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.aprovacao.responderComplemento(id, user.id, dto.resposta);
  }
}
