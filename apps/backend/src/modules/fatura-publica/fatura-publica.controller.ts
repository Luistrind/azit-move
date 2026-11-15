import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { FaturaPublicaService } from './fatura-publica.service';
import { LimitePublicoGuard } from './limite-publico.guard';

// Resposta crua do Fastify (mesmo recorte do dossiê): cabeçalhos + corpo binário.
type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer) => void };

const INTENCAO = z.object({ valor: z.number().int().positive().max(100_000_000) }); // centavos

// Rotas PÚBLICAS da Fatura Azit (doc 02 §32.2): sem login, acesso só pelo token
// longo da fatura. É a única superfície pública além dos webhooks — nenhuma
// rota do app autenticado é exposta aqui, e o mini-app não compartilha sessão
// com o app. Cache desligado: a página é "ao vivo".
@Public()
@UseGuards(LimitePublicoGuard)
@Controller('publico/faturas')
export class FaturaPublicaController {
  constructor(private readonly servico: FaturaPublicaService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  fatura(@Param('token') token: string) {
    return this.servico.porToken(token);
  }

  // Polling da página aberta (~30 s): só o que muda com o pagamento.
  @Get(':token/situacao')
  @Header('Cache-Control', 'no-store')
  situacao(@Param('token') token: string) {
    return this.servico.situacao(token);
  }

  // Pix sob demanda (doc 02 §32.4-A): gera (ou reaproveita) o Pix do valor que
  // o cliente escolheu. O valor é VALIDADO no servidor pela regra do motor; o
  // limite por IP/token do guard e o teto diário por conta seguram abuso.
  @Post(':token/intencao')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  intencao(@Param('token') token: string, @Body(new ZodValidationPipe(INTENCAO)) dto: { valor: number }) {
    return this.servico.criarIntencao(token, dto.valor);
  }

  // PDF da fatura (em aberto) ou comprovante (paga) — mesmo conteúdo da página.
  // ?fatura=<nº>: outra fatura da MESMA conta que a página já mostra (modelo AZIT).
  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Query('fatura') fatura: string | undefined, @Res() res: Resposta) {
    const numero = fatura && /^\d{1,9}$/.test(fatura) ? Number(fatura) : undefined;
    const { pdf, nomeArquivo } = await this.servico.pdf(token, numero);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${nomeArquivo}"`)
      .header('Cache-Control', 'no-store')
      .send(pdf);
  }
}
