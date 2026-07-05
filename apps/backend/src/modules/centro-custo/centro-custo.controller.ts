import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CentroCustoService } from './centro-custo.service';

const lancamentoSchema = z.object({
  tipo: z.string().trim().min(2), // manutencao | documentacao | seguro | franquia | outro...
  descricao: z.string().trim().min(2),
  valor: z.coerce.number().int().min(1), // centavos
  data: z.coerce.date().optional(),
});
type LancamentoBody = z.infer<typeof lancamentoSchema>;

// Centro de custo (Doc 2 §4.4-A): visão por veículo + crédito avulso agregado.
@Controller('centros-custo')
export class CentroCustoController {
  constructor(private readonly centro: CentroCustoService) {}

  @Get('ativos')
  ativos() {
    return this.centro.ativos();
  }

  @Get('ativos/:id')
  detalhe(@Param('id') id: string) {
    return this.centro.detalheAtivo(id);
  }

  @Post('ativos/:id/lancamentos')
  @HttpCode(201)
  criarLancamento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(lancamentoSchema)) dto: LancamentoBody,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.centro.criarLancamento(id, dto, user.id);
  }

  @Delete('lancamentos/:id')
  removerLancamento(@Param('id') id: string) {
    return this.centro.removerLancamento(id);
  }

  @Get('credito-avulso')
  creditoAvulso() {
    return this.centro.creditoAvulso();
  }
}
